// SPDX-License-Identifier: GPL-3.0-or-later
// The kit's messages between a page and its builder worker, and the replies the page gets back. Nothing here names
// a website: any site serves the kit's worker and its catalog, and talks to it in these messages.
//
// A call is { id, call, args, data }. `call` is one of the bridge's calls (web/bridge.py's names: set_stock, add_mod,
// remove_mod, mods, tick, check, version, build, info) or one of the kit's own: init, which loads the site's catalog
// and its cores, and add_catalog_mod, which adds a mod the catalog lists. The worker answers { id, log } for each
// line while a build runs, then { id, ok: true, result } or { id, ok: false, error }.
//
// PROTOCOL changes when a call or a reply changes shape; init's reply carries it, so a page knows what it talks to.
export const PROTOCOL = 1

                                                                                                   
                                                                                                                                       

/** A device, as the bridge describes it (bridge.ts device()). */
                      
                                                                                                           
                                                                                  
 
                                                                                            
/** init's reply: the protocol, the engine's version, the catalog loaded and its cores, and the bridge's info. */
                                                                                                                                

/** The stock file: known by its hash (device name, OS version, the device), or refused with the words why. */
                   
                                                                                                   
                                                                                               

/** A mod in the builder's list: the catalog's cores (builtin), the catalog mods added, and the user's own files. */
                   
                                                                                         
                                                                                                                         
                                                                                                           
                                                                                                                     
                                                                                                                    
                                                          
                         
 
                                                                                       
                                                                                                                                       
                                                                        

/** The builder's log: each line with its time in seconds from the start of the build. */
                                    
/** A built file, with its bytes as the page's own copy. */
                                                                                                     
                     
                                                                                                                 
                                                                            
 
                                                                                   
                                             
