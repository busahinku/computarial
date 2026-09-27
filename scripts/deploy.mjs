// Publishes /dist to the gh-pages branch of `origin`. GitHub Pages serves it for free
// on public repos, and nothing beyond git is needed (no Actions, no workflow scope).
import { execFileSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'

const sh = (args, cwd) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim()
const remote = sh(['remote', 'get-url', 'origin'])
const source = sh(['rev-parse', '--short', 'HEAD'])
const message = [`Deploy ${source}`, process.env.COMMIT_TRAILER].filter(Boolean).join('\n\n')

writeFileSync('dist/.nojekyll', '')
rmSync('dist/.git', { recursive: true, force: true })
sh(['init', '-q', '-b', 'gh-pages'], 'dist')
sh(['add', '-A'], 'dist')
sh(['commit', '-q', '-m', message], 'dist')
sh(['push', '-q', '-f', remote, 'gh-pages'], 'dist')
rmSync('dist/.git', { recursive: true, force: true })
console.log(`Published ${source} to gh-pages`)
