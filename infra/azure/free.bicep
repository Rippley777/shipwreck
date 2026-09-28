param location string = resourceGroup().location
param appName string
param appUrl string = 'https://${appName}.azurewebsites.net'
@secure()
param encryptionKey string
@secure()
param githubConfiguration object = {}
var githubSettings = [for name in objectKeys(githubConfiguration): { name: name, value: githubConfiguration[name] }]
resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'shipwreck-free-plan'
  location: location
  kind: 'linux'
  sku: { name: 'F1', tier: 'Free', capacity: 1 }
  properties: { reserved: true }
}
resource app 'Microsoft.Web/sites@2024-04-01' = {
  name: appName
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|22-lts'
      appCommandLine: 'node server.js'
      alwaysOn: false
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: concat([
        { name: 'APP_URL', value: appUrl }
        { name: 'NODE_ENV', value: 'production' }
        { name: 'HOSTNAME', value: '0.0.0.0' }
        { name: 'ENABLE_DEMO', value: 'false' }
        { name: 'DATABASE_URL', value: '' }
        { name: 'EMBEDDED_DATABASE_PATH', value: '/home/shipwreck/data' }
        { name: 'TOKEN_ENCRYPTION_KEY', value: encryptionKey }
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
        { name: 'ENABLE_ORYX_BUILD', value: 'false' }
        { name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE', value: 'true' }
      ], githubSettings)
    }
  }
}
output appUrl string = 'https://${app.properties.defaultHostName}'
output appName string = app.name
