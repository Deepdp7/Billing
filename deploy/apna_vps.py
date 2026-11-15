"""Apna Billing: deploy the license server to the VPS, build the client installer, and publish updates.

    python deploy/apna_vps.py setup                 first time only: prepare /home/apna-billing on the VPS
    python deploy/apna_vps.py deploy                upload the license server + Admin Panel and restart it
    python deploy/apna_vps.py admin                 create an Admin Panel login (OWNER)
    python deploy/apna_vps.py build                 build the client installer (.exe) that talks to the VPS
    python deploy/apna_vps.py build --next          raise the version by one, then build (for Admin Panel > App Updates)
    python deploy/apna_vps.py release [1.2.3] [--required] [--notes "What changed"]
                                                    build + upload + publish an update (pushed to every open app)

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
        self.c.connect(CFG['host'], username=CFG['user'], password=pw, timeout=30, allow_agent=False, look_for_keys=False)
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


def set_version(version):
    def edit(path, pattern, repl, count=1):
        p = os.path.join(ROOT, path)
        s = open(p, encoding='utf-8').read()
        s2 = re.sub(pattern, repl, s, count=count, flags=re.M)
        open(p, 'w', encoding='utf-8', newline='\n').write(s2)
    edit('tauri/src-tauri/tauri.conf.json', r'^  "version": "[^"]+"', f'  "version": "{version}"')
    edit('tauri/src-tauri/Cargo.toml', r'^version = "[^"]+"', f'version = "{version}"')
    edit('tauri/package.json', r'^  "version": "[^"]+"', f'  "version": "{version}"')
    edit('package.json', r'^  "version": "[^"]+"', f'  "version": "{version}"')


def current_version():
    return json.load(open(os.path.join(ROOT, 'tauri', 'src-tauri', 'tauri.conf.json'), encoding='utf-8'))['version']


def cmd_build(args=None):
    if args is not None and (getattr(args, 'next', False) or getattr(args, 'version', None)):
        old = current_version()
        new = args.version or bump(old)
        if not re.fullmatch(r'\d+\.\d+\.\d+', new):
            raise SystemExit('Version must look like 1.2.3')
        set_version(new)
        try:
            return cmd_build()
        except BaseException:
            set_version(old)
            raise
    if not os.path.exists(CA_FILE):
        raise SystemExit(f'{CA_FILE} is missing. Run "python deploy/apna_vps.py setup" first.')
    if not os.path.exists(UPDATER_KEY):
        raise SystemExit(f'Update signing key missing: {UPDATER_KEY}. Create it with: npx --prefix tauri tauri signer generate --ci -w "{UPDATER_KEY}"')
    version = current_version()
    say(f'Building Apna Billing {version} for {CFG["publicUrl"]}')
    sh('npm run build', cwd=os.path.join(ROOT, 'tauri'), env={
        'LICENSE_SERVER_URL': CFG['publicUrl'],
        'LICENSE_SERVER_CA': CA_FILE,
        'TAURI_SIGNING_PRIVATE_KEY': open(UPDATER_KEY, encoding='utf-8').read(),
        'TAURI_SIGNING_PRIVATE_KEY_PASSWORD': os.environ.get('TAURI_SIGNING_PRIVATE_KEY_PASSWORD', ''),
    })
    nsis = os.path.join(ROOT, 'tauri', 'src-tauri', 'target', 'release', 'bundle', 'nsis')
    exe = next((os.path.join(nsis, f) for f in os.listdir(nsis) if f.endswith(f'_{version}_x64-setup.exe')), None)
    if not exe or not os.path.exists(exe + '.sig'):
        raise SystemExit(f'Installer or signature for {version} not found in {nsis}')
    os.makedirs(RELEASES, exist_ok=True)
    out = os.path.join(RELEASES, f'ApnaBilling-{version}-setup.exe')
    shutil.copyfile(exe, out)
    shutil.copyfile(exe + '.sig', out + '.sig')
    say(f'Installer ready: {out}')
    print(f'   To push it: Admin Panel > App Updates > pick {os.path.basename(out)} and {os.path.basename(out)}.sig')
    return version, out


def bump(v):
    a, b, c = (int(x) for x in v.split('.'))
    return f'{a}.{b}.{c + 1}'


def cmd_release(args):
    old = current_version()
    version = args.version or bump(old)
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise SystemExit('Version must look like 1.2.3')
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


def main():
    p = argparse.ArgumentParser(description='Apna Billing VPS deploy / build / release')
    sub = p.add_subparsers(dest='cmd', required=True)
    sub.add_parser('setup')
    d = sub.add_parser('deploy')
    d.add_argument('--replace-key', action='store_true', help='replace the license signing key on the VPS (invalidates installed apps)')
    sub.add_parser('admin')
    b = sub.add_parser('build')
    b.add_argument('version', nargs='?', help='build this version (e.g. 1.2.0)')
    b.add_argument('--next', action='store_true', help='raise the version by one first')
    r = sub.add_parser('release')
    r.add_argument('version', nargs='?')
    r.add_argument('--required', action='store_true', help='users must install it (no "Later")')
    r.add_argument('--notes', default='')
    args = p.parse_args()
    {'setup': cmd_setup, 'deploy': cmd_deploy, 'admin': cmd_admin, 'build': cmd_build, 'release': cmd_release}[args.cmd](args)


if __name__ == '__main__':
    main()
