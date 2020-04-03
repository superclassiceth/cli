'use strict'

const os = require('os')
const pacote = require('pacote')
const table = require('text-table')
const color = require('ansicolors')
const styles = require('ansistyles')
const npa = require('npm-package-arg')
const pickManifest = require('npm-pick-manifest')

const Arborist = require('@npmcli/arborist')

const npm = require('./npm.js')
const output = require('./utils/output.js')
const ansiTrim = require('./utils/ansi-trim.js')

cmd.usage = 'npm outdated [[<@scope>/]<pkg> ...]'
cmd.completion = require('./utils/completion/installed-deep.js')

module.exports = cmd
function cmd(args, silent, cb) {
  if (typeof cb !== 'function') {
    cb = silent
    silent = false
  }
  outdated(args, silent, cb)
    .then(() => cb())
    .catch(cb)
}

async function outdated (args, silent, cb) {
  const opts = npm.flatOptions
  const where = opts.global
    ? globalTop
    : npm.prefix

  const arb = new Arborist({
    ...opts,
    path: where
  })

  const tree = await arb.loadActual()

  // get dependencies
  const dependencies = tree.package.dependencies
  const devDependencies = tree.package.devDependencies
  const optionalDependencies = tree.package.optionalDependencies
  const allDeps = [...tree.children.keys()]

  const packageDeps = {
    ...dependencies,
    ...devDependencies,
    ...optionalDependencies
  }

  // if (opts.depth !== 0) {
  //   packageDeps.concat(allDeps)
  // }

  const deps = !args.length ? Object.keys(packageDeps) : args

  let list = []
  // gets list of outdated deps
  for (let i = 0; i < deps.length; i++) {
    const dep = deps[i]
    // get dependency type
    const type = dependencies[dep] && 'dependencies'
      || devDependencies[dep] && 'devDependencies'
      || optionalDependencies[dep] && 'optionalDependencies'
    // verify dep status
    const item = await outdated_(tree, dep, packageDeps[dep], type)
    if (item) list.push(item)
  }

  // sorts list alphabetically
  const outdated = list.sort((a, b) => a.name.localeCompare(b.name))

  if (silent) {
    return cb(outdated)
  }

  // display results
  if (opts.json) {
    output(makeJSON(outdated, opts))
  } else if (opts.parseable) {
    output(makeParseable(outdated, opts))
  } else {
    const outList = outdated.map(x => makePretty(x, opts))
    const outHead = ['Package',
      'Current',
      'Wanted',
      'Latest',
      'Location'
    ]

    if (opts.long) outHead.push('Package Type', 'Homepage')
    const outTable = [outHead].concat(outList)

    if (opts.color) {
      outTable[0] = outTable[0].map(heading => styles.underline(heading))
    }

    const tableOpts = {
      align: ['l', 'r', 'r', 'r', 'l'],
      stringLength: s => ansiTrim(s).length
    }
    output(table(outTable, tableOpts))
  }

  process.exitCode = outdated.length ? 1 : 0

}

async function outdated_ (tree, dep, version, type = 'dependencies') {
  const spec = npa(dep)
  const node = tree.children.get(dep)
  
  try {
    const packument = await pacote.packument(spec, { 'prefer-online': true })
    const wanted = pickManifest(packument, version)
    const latest = pickManifest(packument, 'latest')

    let current, path, homepage
    if (node) {
      path = node.path
      current = node.package.version
      homepage = node.package.homepage
    }

    // devDependencies not currently installed
    // are not included in the output
    if (!current && type === 'devDependencies') return

    if (
      !current ||
      current !== wanted.version ||
      wanted.version !== latest.version
    ) {
      return {
        name: dep,
        type,
        path,
        current,
        homepage,
        wanted: wanted.version,
        latest: latest.version,
        location: tree.package.name
      }
    }

  } catch (err) {
    // silently catch and ignore ETARGET, E403 &
    // E404 errors, deps are just skipped
    if (!(
      err.code === 'ETARGET' ||
      err.code === 'E403' ||
      err.code === 'E404')
    ) {
      throw(err)
    }
  }
  return
}

// formatting functions
function makePretty (dep, opts) {
  const {
    current = 'MISSING',
    location = 'global',
    homepage = '',
    name,
    wanted,
    latest, 
    type,
  } = dep

  const columns = [name, current, wanted, latest, location]

  if (opts.long) {
    columns[5] = type
    columns[6] = homepage
  }

  if (opts.color) {
    columns[0] = color[current === wanted ? 'yellow' : 'red'](columns[0]) // current
    columns[2] = color.green(columns[2]) // wanted
    columns[3] = color.magenta(columns[3]) // latest
  }

  return columns
}

// --parseable creates output like this:	
// <fullpath>:<name@wanted>:<name@installed>:<name@latest>	
function makeParseable (list, opts) {
  return list.map(dep => {
    const { name, current, wanted, latest, path, type, homepage } = dep
    const out = [
      path,
      name + '@' + wanted,
      current? (name + '@' + current) : 'MISSING',
      name + '@' + latest
    ]
    if (opts.long) out.push(type, homepage)

    return out.join(':')
  }).join(os.EOL)
}

function makeJSON (list, opts) {
  const out = {}
  list.forEach(dep => {
    const { name, current, wanted, latest, path, type, homepage } = dep
    out[name] = {
      current,
      wanted,
      latest,
      location: path
    }
    if (opts.long) {
      out[name].type = type
      out[name].homepage = homepage
    }
  })
  return JSON.stringify(out, null, 2)
}
