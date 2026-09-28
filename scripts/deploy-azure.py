#!/usr/bin/env python3
"""Deploy Shipwreck to the active Azure subscription. Requires az and Docker."""
import argparse
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
from datetime import datetime, timezone
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / '.shipwreck' / 'azure' / 'state.json'


def run(args, capture=False):
    result = subprocess.run(args, cwd=ROOT, check=True, text=True,
                            stdout=subprocess.PIPE if capture else None)
    return result.stdout if capture else None


def save(state):
    STATE.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    STATE.parent.chmod(0o700)
    # Atomic replacement; restrictive permissions apply before writing secrets.
    fd, temporary = tempfile.mkstemp(dir=STATE.parent)
    try:
        with os.fdopen(fd, 'w') as file:
            json.dump(state, file, indent=2)
        os.replace(temporary, STATE)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def deployment(group, name, template, values):
    parameters = {'$schema': 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#',
                  'contentVersion': '1.0.0.0',
                  'parameters': {key: {'value': value} for key, value in values.items()}}
    # Secrets go into a private temporary parameter file, never command arguments.
    with tempfile.TemporaryDirectory() as directory:
        parameter_file = Path(directory) / 'parameters.json'
        fd = os.open(parameter_file, os.O_WRONLY | os.O_CREAT, 0o600)
        with os.fdopen(fd, 'w') as file:
            json.dump(parameters, file)
        result = run(['az', 'deployment', 'group', 'create', '-g', group, '-n', name,
                      '--template-file', str(ROOT / template), '--parameters', '@' + str(parameter_file),
                      '--query', 'properties.outputs', '-o', 'json', '--only-show-errors'], True)
    return {key: value['value'] for key, value in json.loads(result).items()}


def github_env(path):
    values = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        name, separator, value = line.partition('=')
        if not separator:
            raise ValueError('GitHub env file must contain NAME=value lines.')
        name = name.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if name.startswith('GITHUB_') and value:
            values[name] = value
    key_path = values.pop('GITHUB_APP_PRIVATE_KEY_PATH', None)
    if key_path:
        private_key = Path(key_path).expanduser()
        if not private_key.is_absolute():
            private_key = path.parent / private_key
        values['GITHUB_APP_PRIVATE_KEY'] = private_key.read_text()
    allowed = {'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_APP_ID', 'GITHUB_APP_SLUG',
               'GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET', 'GITHUB_APP_PRIVATE_KEY'}
    if set(values) - allowed:
        raise ValueError('Unsupported GitHub environment variable.')
    required = {'GITHUB_APP_ID', 'GITHUB_APP_SLUG', 'GITHUB_APP_CLIENT_ID',
                'GITHUB_APP_CLIENT_SECRET', 'GITHUB_APP_PRIVATE_KEY'}
    if set(values) & required and not required <= set(values):
        raise ValueError('Provide all five GitHub App settings together.')
    return values


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--location', default='centralus')
    parser.add_argument('--resource-group', default='rg-shipwreck-prod')
    parser.add_argument('--github-env', type=Path, help='Private dotenv file containing GitHub settings')
    parser.add_argument('--image-tag', help='Use an image already pushed to the deployment registry')
    parser.add_argument('--reuse-image', action='store_true', help='Use the image tag saved by the previous deployment')
    parser.add_argument('--local-image', help='Push an existing local Docker image instead of building')
    parser.add_argument('--app-only', action='store_true', help='Skip foundation; requires existing state')
    args = parser.parse_args()
    account = json.loads(run(['az', 'account', 'show', '-o', 'json'], True))
    if STATE.exists():
        state = json.loads(STATE.read_text())
        if state['subscriptionId'] != account['id'] or state['resourceGroup'] != args.resource_group:
            raise ValueError('Saved deployment belongs to a different subscription or resource group.')
        if state['location'] != args.location:
            raise ValueError('Use the saved deployment region; changing it requires a separate deployment.')
    else:
        if args.app_only:
            raise ValueError('Deploy foundation first.')
        state = {'subscriptionId': account['id'], 'resourceGroup': args.resource_group,
                 'location': args.location, 'prefix': 'shipwreck',
                 'databasePassword': secrets.token_urlsafe(36), 'encryptionKey': secrets.token_hex(32),
                 'githubConfiguration': {}}
        save(state)
    if args.github_env:
        state['githubConfiguration'] = github_env(args.github_env.expanduser().resolve())
        save(state)
    print(f"Deploying to {account['name']} / {state['resourceGroup']} / {state['location']}", flush=True)
    if not args.app_only:
        run(['az', 'group', 'create', '-n', state['resourceGroup'], '-l', state['location'],
             '--tags', 'application=shipwreck', 'environment=production', '-o', 'none'])
        print('Deploying network, registry, database and app environment...', flush=True)
        state['foundation'] = deployment(state['resourceGroup'], 'shipwreck-foundation',
                                         'infra/azure/foundation.bicep',
                                         {'location': state['location'], 'prefix': state['prefix'],
                                          'databasePassword': state['databasePassword']})
        save(state)
    foundation = state['foundation']
    if args.reuse_image and not state.get('imageTag'):
        raise ValueError('No previous image tag is saved.')
    image_tag = args.image_tag or (state.get('imageTag') if args.reuse_image else None) or datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')
    if not args.image_tag and not args.reuse_image:
        image = foundation['registryServer'] + '/shipwreck:' + image_tag
        if args.local_image:
            run(['docker', 'tag', args.local_image, image])
        else:
            run(['docker', 'buildx', 'build', '--platform', 'linux/amd64', '--load', '-t', image, '.'])
        run(['az', 'acr', 'login', '-n', foundation['registryName']])
        run(['docker', 'push', image])
    state['imageTag'] = image_tag
    save(state)
    database_url = ('postgresql://shipwreckadmin:' + quote(state['databasePassword'], safe='') + '@' +
                    foundation['databaseHost'] + ':5432/shipwreck?sslmode=verify-full')
    print('Deploying HTTPS application...', flush=True)
    outputs = deployment(state['resourceGroup'], 'shipwreck-app', 'infra/azure/app.bicep',
                         {'location': state['location'], 'prefix': state['prefix'],
                          'environmentName': foundation['environmentName'],
                          'identityName': foundation['identityName'],
                          'registryServer': foundation['registryServer'], 'imageTag': image_tag,
                          'databaseUrl': database_url, 'encryptionKey': state['encryptionKey'],
                          'githubConfiguration': state['githubConfiguration']})
    state.update({'imageTag': image_tag, 'appUrl': outputs['appUrl']})
    save(state)
    print('APP_URL=' + state['appUrl'])
    print('GitHub App callback: ' + state['appUrl'] + '/api/github/app/callback')
    print('GitHub App setup: ' + state['appUrl'] + '/api/github/app/setup')
    print('Deployment secrets saved privately in .shipwreck/azure/state.json. Keep a secure backup.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error))
