#!/usr/bin/env node

/**
 * Production Environment Setup Script
 *
 * Validates and prepares environment for production deployment
 * - Checks required env vars
 * - Validates API connectivity
 * - Tests build process
 * - Generates configuration
 */

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import https from 'https'

const __dirname = path.dirname(new URL(import.meta.url).pathname)
const projectRoot = path.resolve(__dirname, '..')

const REQUIRED_VARS = [
  'VITE_CONTENTSTACK_API_KEY',
  'VITE_CONTENTSTACK_DELIVERY_TOKEN',
  'NEWS_API_KEY',
  'VITE_SITE_URL'
]

const OPTIONAL_VARS = [
  'VITE_DISQUS_SHORTNAME',
  'VITE_GOOGLE_ANALYTICS_ID',
  'VITE_HOTJAR_ID',
  'VITE_MAILCHIMP_API_KEY'
]

class ProductionSetup {
  constructor() {
    this.errors = []
    this.warnings = []
    this.results = {}
  }

  log(message, level = 'info') {
    const colors = {
      info: '\x1b[36m',
      success: '\x1b[32m',
      warning: '\x1b[33m',
      error: '\x1b[31m',
      reset: '\x1b[0m'
    }
    const color = colors[level] || colors.info
    console.log(`${color}[${level.toUpperCase()}]${colors.reset} ${message}`)
  }

  async checkEnvironmentVariables() {
    this.log('Checking environment variables...', 'info')

    const missing = []
    const found = []

    for (const varName of REQUIRED_VARS) {
      if (process.env[varName]) {
        found.push(varName)
      } else {
        missing.push(varName)
      }
    }

    if (missing.length > 0) {
      this.errors.push(`Missing required variables: ${missing.join(', ')}`)
      this.log(`Missing: ${missing.join(', ')}`, 'error')
    }

    if (found.length > 0) {
      this.log(`Found: ${found.join(', ')}`, 'success')
    }

    // Check optional vars
    for (const varName of OPTIONAL_VARS) {
      if (!process.env[varName]) {
        this.warnings.push(`Optional variable not set: ${varName}`)
      }
    }

    this.results.envVars = { found, missing, optional: OPTIONAL_VARS.filter(v => process.env[v]) }
  }

  async testContentstackConnection() {
    this.log('Testing Contentstack API connection...', 'info')

    const apiKey = process.env.VITE_CONTENTSTACK_API_KEY
    const token = process.env.VITE_CONTENTSTACK_DELIVERY_TOKEN

    if (!apiKey || !token) {
      this.warnings.push('Cannot test Contentstack - missing credentials')
      return
    }

    return new Promise((resolve) => {
      const options = {
        hostname: 'api.contentstack.io',
        path: '/v3/content_types',
        method: 'GET',
        headers: {
          'api_key': apiKey,
          'access_token': token
        }
      }

      const req = https.request(options, (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          if (res.statusCode === 200) {
            this.log('Contentstack API: Connected ✓', 'success')
            this.results.contentstack = { connected: true, statusCode: res.statusCode }
          } else {
            this.log(`Contentstack API: Failed (${res.statusCode})`, 'error')
            this.errors.push(`Contentstack API returned status ${res.statusCode}`)
            this.results.contentstack = { connected: false, statusCode: res.statusCode }
          }
          resolve()
        })
      })

      req.on('error', (e) => {
        this.log(`Contentstack API: Error - ${e.message}`, 'error')
        this.errors.push(`Contentstack connection failed: ${e.message}`)
        this.results.contentstack = { connected: false, error: e.message }
        resolve()
      })

      req.end()
    })
  }

  async testNewsAPIConnection() {
    this.log('Testing NewsAPI connection...', 'info')

    const apiKey = process.env.NEWS_API_KEY

    if (!apiKey) {
      this.warnings.push('Cannot test NewsAPI - missing API key')
      return
    }

    return new Promise((resolve) => {
      const url = `https://newsapi.org/v2/top-headlines?country=us&apiKey=${apiKey}&pageSize=1`

      const options = new URL(url)
      const req = https.request(options, (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          if (res.statusCode === 200) {
            const json = JSON.parse(data)
            this.log('NewsAPI: Connected ✓', 'success')
            this.results.newsapi = { connected: true, statusCode: res.statusCode, articles: json.totalResults }
          } else {
            this.log(`NewsAPI: Failed (${res.statusCode})`, 'error')
            this.errors.push(`NewsAPI returned status ${res.statusCode}`)
            this.results.newsapi = { connected: false, statusCode: res.statusCode }
          }
          resolve()
        })
      })

      req.on('error', (e) => {
        this.log(`NewsAPI: Error - ${e.message}`, 'error')
        this.errors.push(`NewsAPI connection failed: ${e.message}`)
        this.results.newsapi = { connected: false, error: e.message }
        resolve()
      })

      req.end()
    })
  }

  async checkNodeVersion() {
    this.log('Checking Node.js version...', 'info')

    const nodeVersion = process.version
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0])

    if (majorVersion >= 18) {
      this.log(`Node.js ${nodeVersion} ✓`, 'success')
      this.results.nodeVersion = { version: nodeVersion, compatible: true }
    } else {
      this.errors.push(`Node.js ${majorVersion} is not supported. Require >=18`)
      this.log(`Node.js ${nodeVersion} ✗`, 'error')
      this.results.nodeVersion = { version: nodeVersion, compatible: false }
    }
  }

  async checkDependencies() {
    this.log('Checking dependencies...', 'info')

    try {
      const pkgPath = path.join(projectRoot, 'package.json')
      if (!fs.existsSync(pkgPath)) {
        this.errors.push('package.json not found')
        return
      }

      const installed = fs.existsSync(path.join(projectRoot, 'node_modules'))
      if (!installed) {
        this.warnings.push('node_modules not installed. Run: npm install')
      } else {
        this.log('Dependencies installed ✓', 'success')
        this.results.dependencies = { installed: true }
      }
    } catch (e) {
      this.errors.push(`Failed to check dependencies: ${e.message}`)
    }
  }

  async testBuild() {
    this.log('Testing build process...', 'info')

    try {
      // Check if vite is available
      execSync('npm list vite', { cwd: projectRoot, stdio: 'pipe' })
      this.log('Build tools available ✓', 'success')
      this.results.build = { toolsAvailable: true }
    } catch (e) {
      this.errors.push('Vite not installed. Run: npm install')
      this.results.build = { toolsAvailable: false }
    }
  }

  createEnvTemplate() {
    this.log('Generating .env.production template...', 'info')

    const template = `# Contentstack Configuration
VITE_CONTENTSTACK_API_KEY=your_api_key_here
VITE_CONTENTSTACK_DELIVERY_TOKEN=your_delivery_token_here
VITE_CONTENTSTACK_DELIVERY_HOST=https://api.contentstack.io

# News Data Source
NEWS_API_KEY=your_newsapi_key_here

# Site Configuration
VITE_SITE_URL=https://news.yourdomain.com
VITE_SITE_NAME=Your News Platform
VITE_SITE_DESCRIPTION=High-quality news and analysis

# Optional: Comment System
VITE_DISQUS_SHORTNAME=your_disqus_shortname

# Optional: Analytics
VITE_GOOGLE_ANALYTICS_ID=G-XXXXXXXXXX
VITE_HOTJAR_ID=hjid

# Optional: Email Newsletter
VITE_MAILCHIMP_API_KEY=your_mailchimp_key
VITE_MAILCHIMP_LIST_ID=your_list_id

# GitHub Actions
GITHUB_TOKEN=your_github_token
LAUNCH_SITE_URL=https://news.yourdomain.com
`

    const templatePath = path.join(projectRoot, '.env.production.template')
    fs.writeFileSync(templatePath, template)
    this.log(`.env.production.template created at ${templatePath}`, 'success')
  }

  createProductionConfig() {
    this.log('Generating production configuration...', 'info')

    const config = {
      environment: 'production',
      timestamp: new Date().toISOString(),
      checks: this.results,
      recommendations: this.warnings,
      errors: this.errors,
      status: this.errors.length === 0 ? 'READY' : 'BLOCKED'
    }

    const configPath = path.join(projectRoot, 'production-config.json')
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
    this.log(`Production config saved to ${configPath}`, 'success')

    return config
  }

  async run() {
    console.log('\n🚀 News Platform — Production Setup\n')

    await this.checkNodeVersion()
    await this.checkDependencies()
    await this.checkEnvironmentVariables()
    await this.testContentstackConnection()
    await this.testNewsAPIConnection()
    await this.testBuild()

    this.createEnvTemplate()
    const config = this.createProductionConfig()

    console.log('\n' + '='.repeat(60))
    console.log('Setup Summary:')
    console.log('='.repeat(60) + '\n')

    if (this.warnings.length > 0) {
      this.log(`Warnings (${this.warnings.length}):`, 'warning')
      this.warnings.forEach(w => console.log(`  • ${w}`))
    }

    if (this.errors.length > 0) {
      this.log(`\nErrors (${this.errors.length}):`, 'error')
      this.errors.forEach(e => console.log(`  • ${e}`))
      process.exit(1)
    }

    this.log('\n✅ Production setup complete!', 'success')
    this.log(`Status: ${config.status}`, config.status === 'READY' ? 'success' : 'error')
    console.log(`\nNext steps:\n`)
    console.log(`  1. Review .env.production.template`)
    console.log(`  2. Copy to .env.production and fill in actual values`)
    console.log(`  3. Run: npm run build`)
    console.log(`  4. Deploy: npm run deploy`)
    console.log('')
  }
}

const setup = new ProductionSetup()
await setup.run()
