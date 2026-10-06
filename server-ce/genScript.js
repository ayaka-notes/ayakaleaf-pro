const services = require('./services')

console.log('#!/bin/bash')
console.log('set -ex')

switch (process.argv.pop()) {
  case 'install':
    console.log('yarn workspaces focus --all --production')
    break
  case 'compile':
    for (const service of services) {
      console.log('pushd', `services/${service.name}`)
      switch (service.name) {
        case 'web':
          // precompile pug in background
          console.log('yarn run precompile-pug &')
          console.log('pug_precompile=$!')

          // Avoid downloading of cypress
          console.log('export CYPRESS_INSTALL_BINARY=0')

          // install webpack and frontend dependencies
          console.log('yarn install || yarn install || yarn install')
          // run webpack
          console.log('yarn run webpack:production')
          // fetch Pyodide wheel bundle (numpy/matplotlib/etc.) for the python-runner module
          console.log('yarn run pyodide:fetch')
          // uninstall webpack and frontend dependencies
          console.log('yarn workspaces focus --all --production')

          // Wait for pug precompile to finish
          console.log('wait "$pug_precompile"')
          break
        default:
          console.log(`echo ${service.name} does not require a compilation`)
      }
      console.log('popd')
    }
    break
  default:
    console.error('unknown command')
    console.log('exit 101')
    process.exit(101)
}
