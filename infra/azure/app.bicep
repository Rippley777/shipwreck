param location string = resourceGroup().location
param prefix string
param environmentName string
param identityName string
param registryServer string
param imageTag string
@secure()
param databaseUrl string
@secure()
param encryptionKey string
@secure()
param githubConfiguration object = {}
var githubNames = objectKeys(githubConfiguration)
var githubSecrets = [for (name, i) in githubNames: {name: 'github-${i}', value: githubConfiguration[name]}]
var githubEnv = [for (name, i) in githubNames: {name: name, secretRef: 'github-${i}'}]
resource environment 'Microsoft.App/managedEnvironments@2025-01-01' existing = { name: environmentName }
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = { name: identityName }
resource app 'Microsoft.App/containerApps@2025-01-01' = {
  name: prefix
  location: location
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  properties: {
    managedEnvironmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: true, targetPort: 3000, transport: 'auto', allowInsecure: false }
      registries: [{ server: registryServer, identity: identity.id }]
      secrets: concat([
        { name: 'database-url', value: databaseUrl }
        { name: 'encryption-key', value: encryptionKey }
      ], githubSecrets)
    }
    template: {
      containers: [{
        name: 'shipwreck'
        image: '${registryServer}/shipwreck:${imageTag}'
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: concat([
          { name: 'APP_URL', value: 'https://${prefix}.${environment.properties.defaultDomain}' }
          { name: 'DATABASE_URL', secretRef: 'database-url' }
          { name: 'TOKEN_ENCRYPTION_KEY', secretRef: 'encryption-key' }
          { name: 'ENABLE_DEMO', value: 'false' }
          { name: 'PORT', value: '3000' }
        ], githubEnv)
        probes: [
          { type: 'Startup', tcpSocket: { port: 3000 }, initialDelaySeconds: 10, periodSeconds: 5, failureThreshold: 60 }
          { type: 'Liveness', tcpSocket: { port: 3000 }, periodSeconds: 30, failureThreshold: 3 }
          { type: 'Readiness', httpGet: { path: '/api/health', port: 3000 }, periodSeconds: 10, timeoutSeconds: 5, failureThreshold: 3 }
        ]
      }]
      scale: { minReplicas: 0, maxReplicas: 1, rules: [{ name: 'http', http: { metadata: { concurrentRequests: '10' } } }] }
    }
  }
}
output appUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
