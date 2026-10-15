# Build on macOS; bundles Python, Cocoa bridge, BLE and the production UI.
from PyInstaller.utils.hooks import collect_submodules

a = Analysis(['scripts/desktop_entry.py'], pathex=['.'],
    binaries=[], datas=[('frontend/dist', 'frontend/dist')],
    hiddenimports=collect_submodules('bleak.backends.corebluetooth') + ['webview.platforms.cocoa', 'keyring.backends.macOS'],
    hookspath=[], hooksconfig={}, runtime_hooks=[], excludes=['tkinter', 'PyQt5', 'PyQt6', 'PySide6'])
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='ThermoNest', debug=False, strip=False, upx=False, console=False)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name='ThermoNest')
app = BUNDLE(coll, name='ThermoNest.app', bundle_identifier='local.thermonest.desktop',
    info_plist={'CFBundleName': 'ThermoNest', 'CFBundleDisplayName': 'ThermoNest',
    'CFBundleShortVersionString': '0.2.0', 'NSHighResolutionCapable': True,
    'NSBluetoothAlwaysUsageDescription': 'ThermoNest uses Bluetooth to read your nearby temperature and humidity sensors.',
    'NSBluetoothPeripheralUsageDescription': 'ThermoNest connects to your local climate sensors.',
    'NSLocalNetworkUsageDescription': 'ThermoNest displays its local dashboard on this Mac.',
    'LSMinimumSystemVersion': '12.3'})
