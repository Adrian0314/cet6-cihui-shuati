"""Build a dependency-free Tencent SCF Web function ZIP, with Linux bootstrap permissions."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent
FILES = ('server.mjs', 'pronunciation-worker.js', 'package.json', 'scf_bootstrap')

def build():
    target = ROOT / 'tencent-scf.zip'
    with ZipFile(target, 'w', compression=ZIP_DEFLATED) as archive:
        for name in FILES:
            item = ZipInfo(name, date_time=(2026, 10, 7, 0, 0, 0))
            item.create_system = 3
            item.external_attr = (0o100755 if name == 'scf_bootstrap' else 0o100644) << 16
            item.compress_type = ZIP_DEFLATED
            # Bootstrap must use LF (not the Windows CRLF produced by some editors).
            archive.writestr(item, (ROOT / name).read_bytes().replace(b'\r\n', b'\n'))
    print(f'Built {target.name}: {target.stat().st_size} bytes; no secrets or npm dependencies.')

if __name__ == '__main__':
    build()
