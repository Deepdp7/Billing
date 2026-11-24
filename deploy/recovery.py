"""Off-server backups and disaster recovery for the central server (used by apna_vps.py).

The server encrypts every backup to the owner's backup key (SuperAdmin server/src/backup.ts); the owner's Admin app
keeps the backups and the recovery key (the private backup key, locked with the recovery password) in
Documents\\Winteg Wave Backups. Everything here works on those files:

    seal(public_pem, data)        what Upload does with the CA key (only root can read it on the VPS)
    open_backup(path, password)   the files of a backup (database, keys, certificate, settings)
    sign_address(url)             the signed "the server is now here" note the installed apps follow

Format (same as the server's): MAGIC, one line of JSON (ephemeral P-256 public key, salt, iv), then AES-256-GCM
ciphertext + tag; the key is HKDF-SHA256(ECDH(ephemeral, backup key), salt, "winteg-backup-v1").
"""
import base64
import ctypes
import datetime
import glob
import gzip
import hashlib
import json
import os

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, ed25519
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

BACKUP_MAGIC = b'WWBACKUP1\n'
BLOB_MAGIC = b'WWBLOB1\n'
INFO = b'winteg-backup-v1'


def documents_dir():
    """The user's Documents folder (where Windows really keeps it, OneDrive included), as the Admin app uses"""
    if os.name == 'nt':
        class GUID(ctypes.Structure):
            _fields_ = [('a', ctypes.c_uint32), ('b', ctypes.c_uint16), ('c', ctypes.c_uint16), ('d', ctypes.c_ubyte * 8)]
        documents = GUID(0xFDD39AD0, 0x238F, 0x46AF, (ctypes.c_ubyte * 8)(0xAD, 0xB4, 0x6C, 0x85, 0x48, 0x03, 0x69, 0xC7))
        out = ctypes.c_wchar_p()
        if ctypes.windll.shell32.SHGetKnownFolderPath(ctypes.byref(documents), 0, None, ctypes.byref(out)) == 0:
            path = out.value
            ctypes.windll.ole32.CoTaskMemFree(out)
            return path
    return os.path.join(os.path.expanduser('~'), 'Documents')


BACKUP_DIR = os.path.join(documents_dir(), 'Winteg Wave Backups')
b64 = lambda b: base64.b64encode(b).decode()
unb64 = base64.b64decode


def _key(shared, salt):
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=salt, info=INFO).derive(shared)


def seal(public_pem, data):
    """Encrypts data to the backup key (anyone can seal; only the recovery password opens)"""
    recipient = serialization.load_pem_public_key(public_pem if isinstance(public_pem, bytes) else public_pem.encode())
    eph = ec.generate_private_key(ec.SECP256R1())
    salt, iv = os.urandom(16), os.urandom(12)
    body = AESGCM(_key(eph.exchange(ec.ECDH(), recipient), salt)).encrypt(iv, data, None)
    header = {'alg': 'ECDH-P256/HKDF-SHA256/AES-256-GCM', 'salt': b64(salt), 'iv': b64(iv),
              'ephemeral': b64(eph.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo))}
    return BLOB_MAGIC + json.dumps(header).encode() + b'\n' + body


def _split(data, magic):
    if not data.startswith(magic):
        raise SystemExit('This is not a Winteg & Wave backup file.')
    nl = data.index(b'\n', len(magic))
    return json.loads(data[len(magic):nl]), data[nl + 1:]


def _open(header, body, private_key):
    eph = serialization.load_der_public_key(unb64(header['ephemeral']))
    return AESGCM(_key(private_key.exchange(ec.ECDH(), eph), unb64(header['salt']))).decrypt(unb64(header['iv']), body, None)


def unlock(key_file, password):
    """The private backup key from a recovery-key.json, with the recovery password"""
    k = json.load(open(key_file, encoding='utf-8'))
    wrap = hashlib.pbkdf2_hmac('sha256', password.encode(), unb64(k['kdf']['salt']), int(k['kdf']['iterations']), 32)
    try:
        pkcs8 = AESGCM(wrap).decrypt(unb64(k['iv']), unb64(k['wrappedPrivateKey']), None)
    except Exception:
        raise SystemExit('That is not the recovery password for this backup.')
    return serialization.load_der_private_key(pkcs8, None), k


def find_key(folder, fingerprint):
    """The recovery key a backup was made for (a replaced key is kept beside the current one)"""
    for path in sorted(glob.glob(os.path.join(folder, 'recovery-key*.json'))):
        try:
            if json.load(open(path, encoding='utf-8')).get('fingerprint') == fingerprint:
                return path
        except Exception:
            pass
    raise SystemExit(f'No recovery key for this backup (key {fingerprint}) in {folder}. Copy the whole backup folder, recovery-key*.json included.')


def newest_backup(folder=BACKUP_DIR):
    found = sorted(glob.glob(os.path.join(folder, 'winteg-*.wwbak')), reverse=True)
    if not found:
        raise SystemExit(f'No backups in {folder}. Use --file to name one.')
    return found[0]


def open_backup(path, password):
    """{name: bytes} of a backup, its manifest, and the recovery key file it was opened with"""
    header, body = _split(open(path, 'rb').read(), BACKUP_MAGIC)
    key_file = find_key(os.path.dirname(os.path.abspath(path)), header['keyFingerprint'])
    private_key, key_info = unlock(key_file, password)
    plain = gzip.decompress(_open(header, body, private_key))
    nl = plain.index(b'\n')
    manifest = json.loads(plain[:nl])
    files, at = {}, nl + 1
    for f in manifest['files']:
        data = plain[at:at + f['size']]
        if hashlib.sha256(data).hexdigest() != f['sha256']:
            raise SystemExit(f'{f["name"]} in the backup is damaged.')
        files[f['name']] = data
        at += f['size']
    blob = files.pop('tls/ca.key.wwenc', None)
    if blob is not None:
        bh, bb = _split(blob, BLOB_MAGIC)
        files['tls/ca.key'] = _open(bh, bb, private_key)
    return files, manifest, key_info


def public_pem_of(key_info):
    """The backup public key as PEM (the server keeps it in data/backup-public.pem)"""
    return serialization.load_der_public_key(unb64(key_info['publicKey'])).public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)


def sign_address(signing_pem, url, embedded_public_pem):
    """(doc, sig): the signed note "the server is at <url>" the apps follow (licensing/serverAddress.ts)"""
    key = serialization.load_pem_private_key(signing_pem, None)
    if not isinstance(key, ed25519.Ed25519PrivateKey):
        raise SystemExit('The licence-signing key is not an Ed25519 key.')
    mine = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode().strip()
    if mine != embedded_public_pem.strip():
        raise SystemExit('This licence-signing key is not the one the installed apps trust: refusing to sign.')
    doc = json.dumps({'v': 1, 'url': url, 'issuedAt': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')},
                     separators=(',', ':'))
    return doc, b64(key.sign(doc.encode()))
