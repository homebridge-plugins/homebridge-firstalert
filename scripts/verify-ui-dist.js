#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const requiredFiles = [
  'index.html',
  path.join('css', 'style.css'),
  path.join('js', 'ui.js'),
]

const distDir = path.resolve(process.cwd(), 'dist/homebridge-ui/public')
const missing = []

for (const file of requiredFiles) {
  const filePath = path.join(distDir, file)
  if (!fs.existsSync(filePath)) {
    missing.push(filePath)
  }
}

if (missing.length > 0) {
  console.error('✗ UI build verification failed. Missing files:')
  for (const m of missing) console.error('  -', m)
  process.exit(1)
} else {
  console.log('✓ UI build verification passed. All required files are present.')
}
