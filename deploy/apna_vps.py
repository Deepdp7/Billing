"""Apna Billing: deploy the license server to the VPS, build the client installer, and publish updates.

    python deploy/apna_vps.py setup                 first time only: prepare /home/apna-billing on the VPS
    python deploy/apna_vps.py deploy                upload the license server + Admin Panel and restart it
    python deploy/apna_vps.py admin                 create an Admin Panel login (OWNER)
    python deploy/apna_vps.py build                 build the client installer (.exe) that talks to the VPS
    python deploy/apna_vps.py build --next          raise the version by one, then build (for Admin Panel > App Updates)
    python deploy/apna_vps.py build --files-only    build the program only; then make the installer in Installer
                                                    Studio's window (Build installer) and run "sign"
    python deploy/apna_vps.py sign [1.2.3]          sign releases/ApnaBilling-<version>-setup.exe for in-app updates
    python deploy/apna_vps.py admin-app [1.2.3] [--files-only]
                                                    build the Admin desktop app (.exe) that opens the VPS Admin Panel
    python deploy/apna_vps.py release [1.2.3] [--required] [--notes "What changed"]
                                                    build + upload + publish an update (pushed to every open app)
    python deploy/apna_vps.py reset-updates         forget every published version on the VPS (to restart the
                                                    numbering lower, e.g. at 1.0.0); licences are not touched

Settings: deploy/vps.json. Passwords are asked for (or read from VPS_PASSWORD / APNA_ADMIN_PASSWORD) and never saved.
Needs: Python 3 with paramiko (pip install paramiko), Node.js, Rust (for the installer).
"""
import argparse
import datetime
import getpass
import io
import json
import os
import posixpath
import re
import shlex
import shutil
import ssl
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = json.load(open(os.path.join(ROOT, 'deploy', 'vps.json'), encoding='utf-8'))
BASE = CFG['remoteDir']
CA_FILE = os.path.join(ROOT, CFG['caFile'])
UPDATER_KEY = os.path.join(os.path.expanduser('~'), '.apna-billing', 'updater.key')
RELEASES = os.path.join(ROOT, 'releases')
# Both installers are made by Installer Studio from the projects in deploy/installer-studio. Their hidden app IDs
# must never change: that is how a new installer finds the old install.
def _newest_studio():
    """The installed Installer Studio, or the one built from its source if that is newer (an older copy would leave
    out newer installer features, such as the uninstall clean-up)"""
    candidates = [os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Installer Studio', 'installer-studio.exe'),
                  os.path.join(os.path.expanduser('~'), 'Desktop', 'InstallerStudio', 'src-tauri', 'target', 'release', 'installer-studio.exe')]
    found = [c for c in candidates if os.path.exists(c)]
    return max(found, key=os.path.getmtime) if found else candidates[0]


INSTALLER_STUDIO = os.environ.get('INSTALLER_STUDIO') or _newest_studio()
STUDIO_PROJECTS = os.path.join(ROOT, 'deploy', 'installer-studio')


def say(msg):
    print(f'\n==> {msg}', flush=True)


def sh(cmd, cwd=ROOT, env=None):
    print(f'$ {cmd}', flush=True)
    subprocess.run(cmd, cwd=cwd, shell=True, check=True, env={**os.environ, **(env or {})})


# ---------------------------------------------------------------- SSH

class Vps:
    def __init__(self):
        import paramiko  # imported here so "build" works without it
        pw = os.environ.get('VPS_PASSWORD') or getpass.getpass(f"VPS password for {CFG['user']}@{CFG['host']}: ")
        self.c = paramiko.SSHClient()
        self.c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            self.c.connect(CFG['host'], username=CFG['user'], password=pw, timeout=30, allow_agent=False, look_for_keys=False)
        except paramiko.AuthenticationException:
            raise SystemExit(f"The VPS refused the password for {CFG['user']}@{CFG['host']}. Check it and try again "
                             "(Ctrl+V does not paste at the password prompt; set it first with $env:VPS_PASSWORD = '...').")
        self.sftp = self.c.open_sftp()

    def run(self, cmd, check=True, quiet=False):
        _, out, err = self.c.exec_command(f'bash -lc {shlex.quote(cmd)}', timeout=1800)
        text = ''
        for line in iter(out.readline, ''):
            text += line
            if not quiet:
                sys.stdout.write('   ' + line)
        e = err.read().decode(errors='replace')
        status = out.channel.recv_exit_status()
        if e and (status != 0 or not quiet):
            sys.stdout.write(e)
        if check and status != 0:
            raise SystemExit(f'Remote command failed ({status}): {cmd}')
        return text

    def put_bytes(self, data, remote):
        with self.sftp.open(remote, 'wb') as f:
            f.write(data)

    def put(self, local, remote, label=None):
        size = os.path.getsize(local)
        last = [0.0]

        def progress(done, total):
            if time.time() - last[0] > 2 or done == total:
                last[0] = time.time()
                print(f'   {label or os.path.basename(local)}: {done * 100 // max(total, 1)}% of {size // 1048576} MB', flush=True)
        self.sftp.put(local, remote, callback=progress)

    def get(self, remote, local):
        self.sftp.get(remote, local)

    def close(self):
        self.c.close()


# ---------------------------------------------------------------- HTTPS to our own server (pinned certificate)

def api(method, path, body=None, token=None):
    ctx = ssl.create_default_context(cafile=CA_FILE)
    req = urllib.request.Request(CFG['publicUrl'] + path, method=method,
                                 data=None if body is None else json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json', **({'Authorization': f'Bearer {token}'} if token else {})})
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=30) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')


def admin_login():
    email = CFG['adminEmail']
    pw = os.environ.get('APNA_ADMIN_PASSWORD') or getpass.getpass(f'Admin Panel password for {email}: ')
    status, data = api('POST', '/api/admin/v1/auth/login', {'email': email, 'password': pw})
    if status != 200:
        raise SystemExit(f'Admin login failed: {data.get("message", status)}')
    return data['token']


# ---------------------------------------------------------------- commands

def cmd_setup(_args):
    vps = Vps()
    say('Preparing /home/apna-billing on the VPS (nothing else is touched)')
    vps.run(f'mkdir -p {BASE}')
    vps.put_bytes(open(os.path.join(ROOT, 'deploy', 'vps-setup.sh'), 'rb').read().replace(b'\r\n', b'\n'), f'{BASE}/vps-setup.sh')
    vps.run(f"PUBLIC_IP={CFG['host']} PORT={CFG['port']} bash {BASE}/vps-setup.sh")
    say('Downloading the server certificate (public part only) for the desktop app')
    vps.get(f'{BASE}/tls/ca.crt', CA_FILE)
    print(f'   saved {CA_FILE}')
    vps.close()


def package_server():
    say('Building the license server and Admin Panel')
    sh('npm run build', cwd=os.path.join(ROOT, 'admin-panel'))
    sh('npm run build', cwd=os.path.join(ROOT, 'license-server'))
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w:gz') as tar:
        ls = os.path.join(ROOT, 'license-server')
        tar.add(os.path.join(ls, 'dist'), arcname='license-server/dist')
        for f in ('package.json', 'package-lock.json'):
            tar.add(os.path.join(ls, f), arcname=f'license-server/{f}')
        tar.add(os.path.join(ROOT, 'deploy', 'backup-db.cjs'), arcname='license-server/backup-db.cjs')
        tar.add(os.path.join(ROOT, 'admin-panel', 'dist'), arcname='admin-panel')
    return buf.getvalue()


def cmd_deploy(args):
    bundle = package_server()
    key = open(os.path.join(ROOT, 'license-server', 'keys', 'signing-private.pem'), 'rb').read()
    vps = Vps()
    say('Uploading')
    vps.put_bytes(bundle, '/tmp/apna-billing-server.tgz')
    vps.put_bytes(key, f'{BASE}/keys/incoming.pem')
    # Public half of the update-signing key: the Admin Panel checks uploaded installers against it.
    updater_pub = json.load(open(os.path.join(ROOT, 'tauri', 'src-tauri', 'tauri.conf.json'), encoding='utf-8'))['plugins']['updater']['pubkey']
    vps.put_bytes(updater_pub.encode(), f'{BASE}/keys/updater.pub')
    say('Installing on the VPS')
    vps.run(f'''set -e
cd {BASE}
# The license signing key is set once. A different key would invalidate every installed app, so refuse unless asked.
if [ ! -f keys/signing-private.pem ]; then mv keys/incoming.pem keys/signing-private.pem; echo "   signing key installed";
elif cmp -s keys/incoming.pem keys/signing-private.pem; then rm keys/incoming.pem;
elif [ "{1 if args.replace_key else 0}" = "1" ]; then cp keys/signing-private.pem keys/signing-private.pem.$(date +%s).bak; mv keys/incoming.pem keys/signing-private.pem; echo "   signing key REPLACED";
else rm keys/incoming.pem; echo "The VPS already has a different license signing key. Re-run with --replace-key only if you mean it." >&2; exit 3; fi
rm -rf license-server/dist admin-panel.new && mkdir -p admin-panel.new
tar -xzf /tmp/apna-billing-server.tgz -C {BASE} --transform 's,^admin-panel,admin-panel.new,'
rm -rf admin-panel && mv admin-panel.new admin-panel && rm -f /tmp/apna-billing-server.tgz
cd license-server && npm ci --omit=dev --no-audit --no-fund --loglevel=error
chown -R apnabilling:apnabilling {BASE}/license-server {BASE}/admin-panel {BASE}/keys
chmod 600 {BASE}/keys/signing-private.pem && chmod 644 {BASE}/keys/updater.pub
systemctl restart apna-license
for i in $(seq 1 30); do curl -fsk https://127.0.0.1:{CFG['port']}/api/health >/dev/null 2>&1 && break; sleep 1; done
curl -fsk https://127.0.0.1:{CFG['port']}/api/health && echo
''')
    vps.close()
    say('Checking from this computer')
    status, data = api('GET', '/api/health')
    print(f'   {CFG["publicUrl"]}/api/health -> {status} {data}')


def cmd_admin(_args):
    email = CFG['adminEmail']
    pw = os.environ.get('APNA_ADMIN_PASSWORD') or getpass.getpass(f'New Admin Panel password for {email} (min 10 characters): ')
    name = os.environ.get('APNA_ADMIN_NAME', 'Owner')
    vps = Vps()
    say(f'Creating Admin Panel login {email}')
    vps.run(f"cd {BASE}/license-server && set -a && . {BASE}/license.env && set +a && "
            f"runuser -u apnabilling -- /usr/bin/node dist/scripts/createAdmin.js {json.dumps(email)} {json.dumps(name)} {json.dumps(pw)} OWNER",
            check=False)
    vps.close()


# Update N of the same version (1.2.3+2): the app files keep 1.2.3 and this file holds N, which the build compiles in
# (APNA_BUILD, see app_version() in tauri/src-tauri/src/lib.rs). Clients still see 1.2.3; updates tell them apart.
UPDATE_NUMBER_FILE = os.path.join(ROOT, 'tauri', 'update-number.txt')


def set_version(version):
    version, _, update = version.partition('+')
    with open(UPDATE_NUMBER_FILE, 'w', encoding='utf-8', newline='\n') as f:
        f.write(update)

    def edit(path, pattern, repl, count=1):
        p = os.path.join(ROOT, path)
        s = open(p, encoding='utf-8').read()
        s2 = re.sub(pattern, repl, s, count=count, flags=re.M)
        open(p, 'w', encoding='utf-8', newline='\n').write(s2)
    edit('tauri/src-tauri/tauri.conf.json', r'^  "version": "[^"]+"', f'  "version": "{version}"')
    edit('tauri/src-tauri/Cargo.toml', r'^version = "[^"]+"', f'version = "{version}"')
    edit('tauri/package.json', r'^  "version": "[^"]+"', f'  "version": "{version}"')
    edit('package.json', r'^  "version": "[^"]+"', f'  "version": "{version}"')


ADMIN_CONF = os.path.join(ROOT, 'admin-tauri', 'src-tauri', 'tauri.conf.json')


def set_admin_version(version):
    for path, pattern, repl in [
        ('admin-tauri/src-tauri/tauri.conf.json', r'^  "version": "[^"]+"', f'  "version": "{version}"'),
        ('admin-tauri/src-tauri/Cargo.toml', r'^version = "[^"]+"', f'version = "{version}"'),
        ('admin-tauri/package.json', r'^  "version": "[^"]+"', f'  "version": "{version}"'),
    ]:
        full = os.path.join(ROOT, path)
        text = open(full, encoding='utf-8').read()
        open(full, 'w', encoding='utf-8', newline='\n').write(re.sub(pattern, repl, text, count=1, flags=re.M))


def check_version(v, update_allowed=False):
    if not re.fullmatch(r'\d+\.\d+\.\d+(\+\d+)?' if update_allowed else r'\d+\.\d+\.\d+', v):
        raise SystemExit('Version must look like 1.2.3' + (' (or 1.2.3+2 for another update of 1.2.3)' if update_allowed else ''))


def current_version():
    """The billing app's version, with "+N" when it is update N of that version"""
    version = json.load(open(os.path.join(ROOT, 'tauri', 'src-tauri', 'tauri.conf.json'), encoding='utf-8'))['version']
    try:
        update = open(UPDATE_NUMBER_FILE, encoding='utf-8').read().strip()
    except OSError:
        update = ''
    return f'{version}+{update}' if update else version


def cmd_build(args=None):
    files_only = bool(getattr(args, 'files_only', False))
    if args is not None and (getattr(args, 'next', False) or getattr(args, 'version', None)):
        old = current_version()
        new = args.version or bump(old)
        check_version(new, update_allowed=True)
        set_version(new)
        try:
            return build_client(files_only)
        except BaseException:
            set_version(old)
            raise
    return build_client(files_only)


def sign_installer(out):
    """Signed with the update key: the app only installs updates carrying this signature."""
    say('Signing the installer for in-app updates')
    sh(f'npx --prefix tauri tauri signer sign -f "{UPDATER_KEY}" "{out}"', env={
        'TAURI_SIGNING_PRIVATE_KEY_PASSWORD': os.environ.get('TAURI_SIGNING_PRIVATE_KEY_PASSWORD', ''),
    })
    if not os.path.exists(out + '.sig'):
        raise SystemExit(f'Signature {out}.sig was not written')


def cmd_sign(args):
    version = getattr(args, 'version', None) or current_version()
    out = os.path.join(RELEASES, f'ApnaBilling-{version}-setup.exe')
    if not os.path.exists(out):
        raise SystemExit(f'{out} does not exist yet. Make it first (Build installer in Installer Studio).')
    sign_installer(out)
    say(f'Installer ready: {out}')
    print(f'   To push it: Admin Panel > App Updates > pick {os.path.basename(out)} and {os.path.basename(out)}.sig')


def build_client(files_only=False):
    if not os.path.exists(CA_FILE):
        raise SystemExit(f'{CA_FILE} is missing. Run "python deploy/apna_vps.py setup" first.')
    if not os.path.exists(UPDATER_KEY):
        raise SystemExit(f'Update signing key missing: {UPDATER_KEY}. Create it with: npx --prefix tauri tauri signer generate --ci -w "{UPDATER_KEY}"')
    version = current_version()
    say(f'Building Apna Billing {version} for {CFG["publicUrl"]}')
    sh('npm run build', cwd=os.path.join(ROOT, 'tauri'), env={
        'APNA_BUILD': version.partition('+')[2],
        'LICENSE_SERVER_URL': CFG['publicUrl'],
        'LICENSE_SERVER_CA': CA_FILE,
        'TAURI_SIGNING_PRIVATE_KEY': open(UPDATER_KEY, encoding='utf-8').read(),
        'TAURI_SIGNING_PRIVATE_KEY_PASSWORD': os.environ.get('TAURI_SIGNING_PRIVATE_KEY_PASSWORD', ''),
    })
    # The program: the shell and the sealed engine next to it (nothing else is needed)
    files = os.path.join(RELEASES, 'ApnaBilling-files')
    shutil.rmtree(files, ignore_errors=True)
    os.makedirs(files)
    shutil.copyfile(os.path.join(ROOT, 'tauri', 'src-tauri', 'target', 'release', 'apna-billing.exe'),
                    os.path.join(files, 'Apna Billing.exe'))
    shutil.copytree(os.path.join(ROOT, 'tauri', 'engine'), os.path.join(files, 'engine'))
    # The installer (and Windows' installed-apps list) shows 1.0.1 for 1.0.1+2; only the file name keeps the update number
    out = studio_build('Apna Billing', version.partition('+')[0], files, f'ApnaBilling-{version}-setup', run=not files_only)
    if files_only:
        say(f'Program ready in {files}')
        print('   Next: open "deploy/installer-studio/Apna Billing.isproj" in Installer Studio, press Build installer,')
        print(f'   then sign it: python deploy/apna_vps.py sign {version}')
        return version, out
    sign_installer(out)
    say(f'Installer ready: {out}')
    print(f'   To push it: Admin Panel > App Updates > pick {os.path.basename(out)} and {os.path.basename(out)}.sig')
    return version, out


def studio_build(project, version, files, output_name, run=True):
    """Make an installer with Installer Studio from deploy/installer-studio/<project>.isproj (with run=False only
    fill the project in, for building it in Installer Studio's window)."""
    if run and not os.path.exists(INSTALLER_STUDIO):
        raise SystemExit(f'Installer Studio not found at {INSTALLER_STUDIO}. Install it, or set INSTALLER_STUDIO to its .exe')
    path = os.path.join(STUDIO_PROJECTS, f'{project}.isproj')
    proj = json.load(open(path, encoding='utf-8'))
    brand = os.path.join(ROOT, 'branding', 'installer', 'apna-billing-admin' if 'Admin' in project else 'apna-billing')

    def picture(key, default):
        # Pictures chosen in Installer Studio's window are kept; otherwise the branding ones (3x: Installer Studio
        # makes every display scaling, 100-300%, from them)
        own = proj.get(key) or ''
        return own if os.path.isfile(own) else os.path.join(brand, default)

    # Version and folders follow this build and this checkout; the app ID stays as it is
    proj.update(version=version, sourceDir=files, outputDir=RELEASES, outputName=output_name,
                icon=picture('icon', 'installer-icon.ico'),
                sidebarImage=picture('sidebarImage', 'sidebar-492x942.bmp'),
                headerImage=picture('headerImage', 'header-450x171.bmp'))
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(proj, indent=2) + '\n')
    out = os.path.join(RELEASES, f'{output_name}.exe')
    if not run:
        return out
    say(f'Making the installer with Installer Studio ({os.path.basename(path)})')
    if os.path.exists(out):
        os.remove(out)
    subprocess.run([INSTALLER_STUDIO, 'build', path], check=True)
    if not os.path.exists(out):
        raise SystemExit(f'Installer Studio did not write {out}')
    return out


def cmd_admin_app(args=None):
    if not os.path.exists(CA_FILE):
        raise SystemExit(f'{CA_FILE} is missing. Run "python deploy/apna_vps.py setup" first.')
    files_only = bool(getattr(args, 'files_only', False))
    if getattr(args, 'version', None):
        check_version(args.version)
        set_admin_version(args.version)
    version = json.load(open(ADMIN_CONF, encoding='utf-8'))['version']
    say(f'Building Apna Billing Admin {version} for {CFG["publicUrl"]}')
    sh('npm run build -- --no-bundle', cwd=os.path.join(ROOT, 'admin-tauri'), env={
        'APNA_ADMIN_SERVER_URL': CFG['publicUrl'],
        'APNA_ADMIN_SERVER_CA': CA_FILE,
    })
    # The program: one .exe, nothing else is needed
    files = os.path.join(RELEASES, 'ApnaBillingAdmin-files')
    shutil.rmtree(files, ignore_errors=True)
    os.makedirs(files)
    shutil.copyfile(os.path.join(ROOT, 'admin-tauri', 'src-tauri', 'target', 'release', 'apna-billing-admin.exe'),
                    os.path.join(files, 'Apna Billing Admin.exe'))
    out = studio_build('Apna Billing Admin', version, files, f'ApnaBillingAdmin-{version}-setup', run=not files_only)
    if files_only:
        say(f'Program ready in {files}')
        print('   Next: open "deploy/installer-studio/Apna Billing Admin.isproj" in Installer Studio and press Build installer.')
        return out
    say(f'Admin app ready: {out}')
    print('   Install it on your own PC only (never give it to clients). Log in with your Admin Panel email and password.')
    return out


def bump(v):
    a, b, c = (int(x) for x in v.split('+')[0].split('.'))
    return f'{a}.{b}.{c + 1}'


def cmd_release(args):
    old = current_version()
    version = args.version or bump(old)
    check_version(version, update_allowed=True)
    token = admin_login()  # fail early, before the long build
    set_version(version)
    try:
        version, exe = cmd_build()
    except BaseException:
        set_version(old)
        raise
    name = f'ApnaBilling-{version}-setup.exe'
    url = f'{CFG["publicUrl"]}/updates/{name}'
    notes = args.notes or f'Apna Billing {version}'
    manifest = {
        'version': version,
        'notes': notes,
        'pub_date': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'platforms': {'windows-x86_64': {'signature': open(exe + '.sig', encoding='utf-8').read().strip(), 'url': url}},
    }
    vps = Vps()
    say('Uploading the update')
    vps.put(exe, f'{BASE}/updates/{name}.part', label=name)
    vps.put_bytes(json.dumps(manifest, indent=2).encode(), f'{BASE}/updates/latest.json.part')
    vps.run(f'cd {BASE}/updates && mv {name}.part {name} && mv latest.json.part latest.json && chown apnabilling:apnabilling * && ls -la')
    vps.close()
    say('Publishing: every open app gets the popup now, closed ones when they next open')
    settings = {'latest_version': version, 'update_url': url, 'update_message': notes}
    if args.required:
        settings['min_supported_version'] = version
    status, data = api('PUT', '/api/admin/v1/settings', settings, token)
    if status != 200:
        raise SystemExit(f'Uploaded, but publishing failed: {data.get("message", status)}. Set "Latest version" to {version} in Admin Panel > System Settings.')
    print(f'   published {version}{" (REQUIRED)" if args.required else ""}')
    say(f'Done. Installer for new clients: {exe}')


# Run on the VPS as the server's user, so the database files keep their owner. Prints the update state as JSON;
# with "reset", first backs the database up into backups/, then forgets every release.
RESET_JS = r"""
const db = require('better-sqlite3')(process.env.SQLITE_FILE);
const keys = ['latest_version', 'min_supported_version', 'update_url', 'update_message'];
const state = () => ({
  releases: db.prepare('select version, status from app_releases').all(),
  settings: Object.fromEntries(db.prepare(`select key, value from settings where key in (${keys.map(() => '?')})`).all(...keys).map(r => [r.key, r.value])),
  installs: db.prepare("select app_version, count(*) n from installations where status != 'DEACTIVATED' group by app_version").all(),
});
(async () => {
  if (process.argv[1] === 'reset') {
    await db.backup(process.argv[2]);
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare('delete from app_releases').run();
      for (const [k, v] of [['latest_version', ''], ['min_supported_version', '0.0.0'], ['update_url', ''], ['update_message', '']])
        db.prepare('update settings set value = ?, updated_at = ? where key = ?').run(v, now, k);
    })();
  }
  console.log(JSON.stringify(state()));
  db.close();
})();
"""


def cmd_reset_updates(_args):
    vps = Vps()
    node = f'cd {BASE}/license-server && set -a && . {BASE}/license.env && set +a && runuser -u apnabilling -- node -e {shlex.quote(RESET_JS)}'
    state = json.loads(vps.run(f'{node} show', quiet=True).strip().splitlines()[-1])
    say('Update state on the VPS now')
    releases = ', '.join(f"{r['version']} ({r['status']})" for r in state['releases'])
    print(f'   releases: {releases or "none"}')
    print(f'   live update: {state["settings"].get("latest_version") or "none"}, required from: {state["settings"].get("min_supported_version") or "-"}')
    print(f'   setup files: {vps.run(f"ls {BASE}/updates", quiet=True).split() or "none"}')
    installs = state['installs']
    versions = ', '.join(f"{i['app_version'] or 'unknown'} x{i['n']}" for i in installs)
    print(f'   installed apps: {versions or "none"}')
    if installs:
        print('   Warning: apps already installed only update to versions ABOVE the one they have.')
    try:
        answer = input('\nForget all of this, so the next version can be any number (you choose it in the build step)?\n'
                       'Type the word RESET to confirm, or just press Enter to cancel: ')
    except EOFError:
        answer = ''
    if answer.strip() != 'RESET':
        raise SystemExit('Nothing changed.')
    backup = f'{BASE}/backups/license-before-update-reset-{time.strftime("%Y%m%d-%H%M%S")}.db'
    after = json.loads(vps.run(f'{node} reset {shlex.quote(backup)}', quiet=True).strip().splitlines()[-1])
    vps.run(f'rm -f {BASE}/updates/ApnaBilling-*-setup.exe {BASE}/updates/latest.json {BASE}/updates/latest.json.paused '
            f'&& chown apnabilling:apnabilling {shlex.quote(backup)} && systemctl restart apna-license '
            f'&& for i in $(seq 1 30); do curl -fsk https://127.0.0.1:{CFG["port"]}/api/health >/dev/null 2>&1 && break; sleep 1; done', quiet=True)
    vps.close()
    say('Done')
    print(f'   releases left: {len(after["releases"])}, live update: {after["settings"].get("latest_version") or "none"}')
    print(f'   database backup: {backup}')
    print('   Next: python deploy/apna_vps.py build 1.0.0   (or any version you like)')


def main():
    p = argparse.ArgumentParser(description='Apna Billing VPS deploy / build / release')
    sub = p.add_subparsers(dest='cmd', required=True)
    sub.add_parser('setup')
    d = sub.add_parser('deploy')
    d.add_argument('--replace-key', action='store_true', help='replace the license signing key on the VPS (invalidates installed apps)')
    sub.add_parser('admin')
    a = sub.add_parser('admin-app')
    a.add_argument('version', nargs='?', help='set the Admin app to this version first (e.g. 1.1.1)')
    a.add_argument('--files-only', action='store_true', help='build the program only (make the installer in Installer Studio)')
    sub.add_parser('reset-updates')
    b = sub.add_parser('build')
    b.add_argument('version', nargs='?', help='build this version (e.g. 1.2.0)')
    b.add_argument('--next', action='store_true', help='raise the version by one first')
    b.add_argument('--files-only', action='store_true', help='build the program only (make the installer in Installer Studio)')
    g = sub.add_parser('sign')
    g.add_argument('version', nargs='?', help='version of releases/ApnaBilling-<version>-setup.exe (default: current)')
    r = sub.add_parser('release')
    r.add_argument('version', nargs='?')
    r.add_argument('--required', action='store_true', help='users must install it (no "Later")')
    r.add_argument('--notes', default='')
    args = p.parse_args()
    {'setup': cmd_setup, 'deploy': cmd_deploy, 'admin': cmd_admin, 'admin-app': cmd_admin_app, 'build': cmd_build,
     'release': cmd_release, 'reset-updates': cmd_reset_updates, 'sign': cmd_sign}[args.cmd](args)


if __name__ == '__main__':
    main()
