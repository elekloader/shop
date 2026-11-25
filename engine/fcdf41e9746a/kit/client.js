// SPDX-License-Identifier: GPL-3.0-or-later
// A page's side of the kit: one builder worker, called with promises. It knows nothing about the site's pages,
// accounts or storage. `worker` starts the kit's worker from the site, for example
//   () => new Worker(new URL('elekloader/kit/worker.js', document.baseURI), { type: 'module' })
// or, through a bundler, new Worker(new URL('…/kit/worker.ts', import.meta.url), { type: 'module' }).
                                                                                                             

                              
                                                                                             
              
                                 
                      
                                                                             
                  
 

                                                                                                               

export function createBuilder(options                ) {
  const base = new URL(options.base, globalThis.location?.href).href
  let worker                    , nextId = 0, closed = false, ready                            
  const pending = new Map              ()

  function fail(message        ) {
    for (const task of pending.values()) task.reject(new Error(message))
    pending.clear(); worker?.terminate(); worker = undefined; ready = undefined
  }

  /** Any call of protocol.ts: the bridge's (set_stock, add_mod, …) or the kit's (init, add_catalog_mod). */
  function call   (name        , args                          = {}, data              , log                         )             {
    if (closed) return Promise.reject(new Error('The builder was closed.'))
    if (!worker) {
      worker = options.worker()
      worker.onerror = () => fail('The builder stopped. Try again.')
      worker.onmessage = (event                      ) => {
        const answer = event.data, task = pending.get(answer.id)
        if (!task) return
        if ('log' in answer) { task.log?.(answer.log); return }
        pending.delete(answer.id)
        if (answer.ok) task.resolve(answer.result)
        else task.reject(new Error(answer.error))
      }
    }
    const id = ++nextId, message       = { id, call: name, args, data }
    return new Promise   ((resolve, reject) => {
      pending.set(id, { resolve: resolve                            , reject, log })
      try { worker .postMessage(message, data ? [data] : []) } catch (error) { pending.delete(id); reject(error         ) }
    })
  }

  return {
    call,
    /** Loads the catalog and its cores, once per builder. */
    load() { return ready ??= call       ('init', { base, catalog: options.catalog ?? 'catalog.json' }).catch(error => { ready = undefined; throw error }) },
    /** The owner's stock OS file: recognised by its hash, or refused. Its bytes go to the worker, not the network. */
    async setStock(file                         ) { return call       ('set_stock', { name: file.name }, await file.arrayBuffer()) },
    /** A mod the site's catalog lists, by its file name there. */
    addCatalogMod(file        ) { return call       ('add_catalog_mod', { file }) },
    /** A mod file of the owner's own. */
    async addMod(file                         ) { return call       ('add_mod', { name: file.name }, await file.arrayBuffer()) },
    removeMod(path        ) { return call              ('remove_mod', { path }) },
    mods() { return call       ('mods') },
    /** Tick a mod, with what it requires: the paths ticked after. */
    tick(enabled                   , path        ) { return call          ('tick', { enabled, path }) },
    check(enabled                   ) { return call       ('check', { enabled }) },
    /** What is wrong with an OS version field, if anything, and a file name for the build. */
    version(version        , enabled                   ) { return call              ('version', { version, enabled }) },
    build(enabled                   , version        , name        , log                         ) { return call             ('build', { enabled, version, name }, undefined, log) },
    /** Stops the worker; the builder cannot be used after. */
    dispose() { closed = true; fail('The builder was closed.') },
  }
}
                                                      
