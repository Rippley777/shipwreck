#!/usr/bin/env python3
"""Preview or deploy Shipwreck to its Azure F1 Free App Service."""

import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / '.shipwreck/azure/free-state.json'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true', help='Show the target and actions without contacting Azure')
    parser.add_argument('--settings-only', action='store_true', help='Update App Service settings without rebuilding code')
    parser.add_argument('--allowed-origins', help='Extra comma-separated origins accepted by the API POST Origin check')
    parser.add_argument('--app-url', help='Canonical HTTPS origin after binding a custom domain in App Service')
    parser.add_argument('--github-env', type=Path, help='Ignored private dotenv file with GitHub credentials')
    parser.add_argument('--resource-group', default='rg-shipwreck-prod')
    parser.add_argument('--location', default='centralus')
    args = parser.parse_args()

    if args.github_env and not args.github_env.is_file():
        parser.error('The GitHub settings file does not exist.')
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    if state and (state['resourceGroup'], state['location']) != (args.resource_group, args.location):
        parser.error('Saved deployment belongs to another group or region. Use its saved values.')
    if args.dry_run:
        print('Target: Azure App Service F1 Free')
        print('Resource group:', args.resource_group)
        print('Region:', args.location)
        print('App:', state.get('appName', '(derived from the selected Azure subscription)'))
        print('Canonical URL:', args.app_url or state.get('appUrl', '(Azure hostname on first deployment)'))
        print('Action:', 'Update settings only' if args.settings_only else 'Build and deploy the app')
        print('Allowed origins:', args.allowed_origins if args.allowed_origins is not None
              else state.get('allowedOrigins', '(none)'))
        print('GitHub settings:', 'Replace from private file' if args.github_env else 'Keep saved settings')
        print('No Azure login, resource changes, image build, or upload was performed.')
        return

    required = ['az'] + ([] if args.settings_only else ['docker'])
    for command in required:
        if not shutil.which(command):
            parser.error(f'{command} is required. See docs/AZURE_DEPLOYMENT.md.')
    account = subprocess.run(['az', 'account', 'show', '--query', '{id:id,name:name}', '-o', 'json'],
                             capture_output=True, text=True, check=False)
    if account.returncode:
        parser.error('Sign in with az login and select the intended subscription with az account set.')
    selected = json.loads(account.stdout)
    if state and state['subscriptionId'] != selected['id']:
        parser.error('The selected Azure subscription differs from the saved deployment.')
    if not args.settings_only:
        docker = subprocess.run(['docker', 'info', '--format', '{{.ServerVersion}}'],
                                capture_output=True, text=True, check=False)
        if docker.returncode:
            parser.error('Start Docker before deploying code, or use --settings-only.')
    print(f"Azure subscription: {selected['name']} ({selected['id']})", flush=True)
    command = [sys.executable, str(ROOT / 'scripts/deploy-azure-free.py'),
               '--resource-group', args.resource_group, '--location', args.location]
    if args.settings_only:
        command.append('--settings-only')
    if args.allowed_origins is not None:
        command.extend(['--allowed-origins', args.allowed_origins])
    if args.app_url:
        command.extend(['--app-url', args.app_url])
    if args.github_env:
        command.extend(['--github-env', str(args.github_env.resolve())])
    raise SystemExit(subprocess.call(command, cwd=ROOT))


if __name__ == '__main__':
    main()
