

let storebycallid = new Map()
let storebyuuid = new Map()
let storebyentity = new Map()

/** @module store */

/**
 *  This can be called multiple times for the same call to store or update. Stores a
 *  call object in our store.
 *  @param {object} c - our call object.
 *  @param {string} c.uuid - uuid of the call
 *  @param {object} c.sip
 *  @param {string} c.sip.callid - the call id string
 *  @param {object} c.sip.tags - the local and remote tags
 *  @param {string} c.sip.tags.local - the local tag
 *  @param {string} c.sip.tags.remote - the remote tag
 *  @param {object} c.entity - entity object
 *  @param {object} c.entity.uri
 *  @return {Promise} - which resolves on completion (for future in case we support redis or similar)
 */
module.exports.set = async ( c ) => {
  if( "object" !== typeof c ) return false
  if( "string" !== typeof c.uuid || 0 === c.uuid.length ) return false
  if( "object" !== typeof c.sip || "string" !== typeof c.sip.callid || 0 === c.sip.callid.length ) return false

  storebyuuid.set( c.uuid, c )

  let callidset = storebycallid.get( c.sip.callid )
  if( callidset ) {
    callidset.add( c )
  } else {
    let s = new Set()
    s.add( c )
    storebycallid.set( c.sip.callid, s )
  }

  let entity = c._entity
  if( !entity ) return true

  let storedentity = storebyentity.get( entity.uri )
  if( undefined === storedentity ) {
    storedentity = new Map()
    storebyentity.set( entity.uri, storedentity )
  }

  storedentity.set( c.uuid, c )

  return true
}

/**
 *  Retreive call object by entity.
 *  @param {string} uri - the entity uri
 *  @return {Promise} which resolves to either a set containing calls for this entity or undefined
 */
module.exports.getbyentity = async ( uri ) => {
  if( !storebyentity.has( uri ) ) return false
  return storebyentity.get( uri )
}

/**
 *  Returns a unique call by call id and sip tags.
 *  @param {object} sip - sip params required
 *  @param {string} sip.callid - the call id string
 *  @param {object} sip.tags - the local and remote tags
 *  @param {string} sip.tags.local - the local tag
 *  @param {string} sip.tags.remote - the remote tag
 *  @return {Promise} which resolves to either the unique call object or undefined
 */
module.exports.getbycallid = async ( sip ) => {
  let callidset = storebycallid.get( sip.callid )
  if( undefined === callidset ) return false

  for( let c of callidset ) {

    if( sip.callid !== c.sip.callid ) continue
    if( c.sip.tags.local !== "" && c.sip.tags.local !== sip.tags.local ) continue
    if( c.sip.tags.remote !== "" && c.sip.tags.remote !== sip.tags.remote ) continue

    return c
  }
}

/**
 * Return a unique call based on UUID
 * @param { string } uuid 
 */
module.exports.getbyuuid = async( uuid ) => {
  return storebyuuid.get( uuid )
}

/**
 * Cleanup a call from all of the stores.
 * @param {object} c - our call object
 */
module.exports.delete = async function( c ) {
  if( undefined === c.uuid || 0 === c.uuid.length ) return false
  storebyuuid.delete( c.uuid )
  let callid = c.sip.callid

  let callidset = storebycallid.get( callid )
  if( undefined !== callidset ) {
    callidset.delete( c )

    if( 0 === callidset.size ) {
      storebycallid.delete( callid )
    }
  }

  let entity = c._entity
  
  if( entity ) {
    if( !entity.uri && entity.username && entity.realm ) {
      entity.uri = entity.username + "@" + entity.realm
    }
    let entityentries = storebyentity.get( entity.uri )
    if( undefined !== entityentries ) {
      entityentries.delete( c.uuid )
      if( 0 === entityentries.size ) {
        storebyentity.delete( entity.uri )
      }
    }
  }
}

/**
 *  Reset our store.
 */
module.exports.clear = async() => {
  storebycallid = new Map()
  storebyuuid = new Map()
  storebyentity = new Map()
}

/**
 *  Return stats for testing etc.
 */
module.exports.stats = async () => {
  return {
    "storebycallid": storebycallid.size,
    "storebyuuid": storebyuuid.size,
    "storebyentity": storebyentity.size
  }
}
