#!/usr/bin/env python3
"""Deploy only Azure F1 Free App Service; no billed plan fallback."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import time
import base64
import urllib.request
import urllib.parse
import urllib.error
import zipfile

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / '.shipwreck/azure/free-state.json'
spec = importlib.util.spec_from_file_location('azure_helpers', ROOT / 'scripts/deploy-azure.py')
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)
run = helpers.run


def wait_for_deployment(state):
    credentials = json.loads(run(['az', 'webapp', 'deployment', 'list-publishing-credentials',
                                  '-g', state['resourceGroup'], '-n', state['appName'], '-o', 'json'], True))
    host = urllib.parse.urlparse(credentials['scmUri']).hostname
    token = base64.b64encode((credentials['publishingUserName'] + ':' + credentials['publishingPassword']).encode()).decode()
    print('Waiting for Azure to finish installing the package...', flush=True)
    for _ in range(90):
        try:
            request = urllib.request.Request('https://' + host + '/api/deployments/latest',
                                             headers={'Authorization': 'Basic ' + token})
            with urllib.request.urlopen(request, timeout=20) as response:
                deployment = json.load(response)
            if deployment.get('status') == 3:
                raise ValueError('Azure package installation failed. Inspect App Service deployment logs.')
            if deployment.get('status') == 4 and deployment.get('complete'):
                break
        except (urllib.error.URLError, TimeoutError):
            pass
        time.sleep(10)
    else:
        raise ValueError('Azure package installation did not finish within the deployment timeout.')
    for _ in range(45):
        try:
            with urllib.request.urlopen(state['appUrl'] + '/api/health', timeout=20) as response:
                if json.load(response) == {'status': 'ok'}:
                    print('HTTPS and database health passed.', flush=True)
                    return
        except (urllib.error.URLError, TimeoutError):
            pass
        time.sleep(5)
    raise ValueError('The deployed app did not pass its database health check.')


def save(state):
    STATE.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    STATE.parent.chmod(0o700)
    fd, temporary = tempfile.mkstemp(dir=STATE.parent)
    with os.fdopen(fd, 'w') as file:
        json.dump(state, file, indent=2)
    os.replace(temporary, STATE)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--location', default='centralus')
    parser.add_argument('--resource-group', default='rg-shipwreck-prod')
    parser.add_argument('--github-env', type=Path)
    parser.add_argument('--local-image', help='Existing Linux AMD64 image containing standalone output')
    parser.add_argument('--settings-only', action='store_true')
    args = parser.parse_args()
    account = json.loads(run(['az', 'account', 'show', '-o', 'json'], True))
    if STATE.exists():
        state = json.loads(STATE.read_text())
        if (state['subscriptionId'], state['resourceGroup'], state['location']) != (account['id'], args.resource_group, args.location):
            raise ValueError('Saved free deployment belongs to another subscription, group or region.')
    else:
        old = json.loads(helpers.STATE.read_text()) if helpers.STATE.exists() else {}
        if old and old['subscriptionId'] != account['id']:
            raise ValueError('Existing state belongs to a different subscription.')
        state = {'subscriptionId': account['id'], 'resourceGroup': args.resource_group,
                 'location': args.location, 'appName': 'shipwreck-free-' + account['id'].replace('-', '')[:12],
                 'encryptionKey': old.get('encryptionKey') or secrets.token_hex(32),
                 'githubConfiguration': old.get('githubConfiguration', {})}
        save(state)
    if args.github_env:
        state['githubConfiguration'] = helpers.github_env(args.github_env.expanduser().resolve())
        save(state)
    print('Deploying Azure App Service F1 Free; no paid fallback.', flush=True)
    run(['az', 'group', 'create', '-g', state['resourceGroup'], '-l', state['location'], '-o', 'none'])
    outputs = helpers.deployment(state['resourceGroup'], 'shipwreck-free', 'infra/azure/free.bicep',
                                 {'location': state['location'], 'appName': state['appName'],
                                  'appUrl': state.get('appUrl', 'https://' + state['appName'] + '.azurewebsites.net'),
                                  'encryptionKey': state['encryptionKey'],
                                  'githubConfiguration': state['githubConfiguration']})
    state['appUrl'] = outputs['appUrl']
    save(state)
    # Avoid emitting app settings, which include credentials.
    with tempfile.TemporaryDirectory() as temporary:
        settings = Path(temporary) / 'settings.json'
        settings.write_text(json.dumps({'APP_URL': state['appUrl']}))
        settings.chmod(0o600)
        run(['az', 'webapp', 'config', 'appsettings', 'set', '-g', state['resourceGroup'],
             '-n', state['appName'], '--settings', '@' + str(settings), '-o', 'none'])
    plan = json.loads(run(['az', 'appservice', 'plan', 'show', '-g', state['resourceGroup'],
                          '-n', 'shipwreck-free-plan', '--query', 'sku', '-o', 'json'], True))
    if plan['name'] != 'F1' or plan['tier'] != 'Free':
        raise ValueError('Deployment refused: hosting plan is not F1 Free.')
    if not args.settings_only:
        image = args.local_image or 'shipwreck:azure-free'
        if not args.local_image:
            run(['docker', 'buildx', 'build', '--platform', 'linux/amd64', '--load', '-t', image, '.'])
        architecture = run(['docker', 'image', 'inspect', image, '--format', '{{.Architecture}}'], True).strip()
        if architecture != 'amd64':
            raise ValueError('The deployment image must be Linux AMD64.')
        with tempfile.TemporaryDirectory() as temporary:
            staging = Path(temporary).resolve() / 'app'
            staging.mkdir()
            container = run(['docker', 'create', '--platform', 'linux/amd64', image], True).strip()
            try:
                run(['docker', 'cp', container + ':/app/.next/standalone/.', str(staging)])
                for source, target in [('public', 'public'), ('.next/static', '.next/static'), ('migrations', 'migrations')]:
                    dest = staging / target
                    if dest.exists():
                        shutil.rmtree(dest)
                    dest.mkdir(parents=True)
                    run(['docker', 'cp', container + ':/app/' + source + '/.', str(dest)])
            finally:
                run(['docker', 'rm', container])
            # ZIP uploads do not preserve Next.js external-package directory links.
            # Materialize them inside the staging tree, including .next/node_modules aliases.
            for path in list(staging.rglob('*')):
                if path.is_symlink():
                    target = path.resolve(strict=True)
                    if not target.is_relative_to(staging):
                        raise ValueError('Deployment link points outside the staging directory.')
                    path.unlink()
                    if target.is_dir():
                        shutil.copytree(target, path, symlinks=False)
                    else:
                        shutil.copy2(target, path)
            # App Service's Node optimizer excludes every nested node_modules folder.
            # Place Turbopack's aliases in the root dependency tree, which it archives.
            aliases = staging / '.next/node_modules'
            if aliases.exists():
                for entry in list(aliases.iterdir()):
                    packages = list(entry.iterdir()) if entry.name.startswith('@') else [entry]
                    for package in packages:
                        destination = staging / 'node_modules' / package.relative_to(aliases)
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        if destination.exists():
                            raise ValueError('External package alias collides with an existing dependency.')
                        shutil.move(str(package), destination)
                shutil.rmtree(aliases)
            archive = Path(temporary) / 'shipwreck.zip'
            with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as file:
                for path in staging.rglob('*'):
                    if path.is_file():
                        file.write(path, path.relative_to(staging))
            print(f'Uploading standalone app ({archive.stat().st_size // 1024 // 1024} MiB)...', flush=True)
            run(['az', 'webapp', 'deploy', '-g', state['resourceGroup'], '-n', state['appName'],
                 '--src-path', str(archive), '--type', 'zip', '--clean', 'true', '--async', 'true', '-o', 'none'])
            wait_for_deployment(state)
    print('APP_URL=' + state['appUrl'])
    print('Persistent embedded storage: /home/shipwreck/data')
    print('F1 hard quotas apply; there is no automatic paid upgrade.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error))
