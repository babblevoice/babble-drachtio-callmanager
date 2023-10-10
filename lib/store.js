

let storebycallid = new Map()
let storebyuuid = new Map()
let storebyentity = new Map()
let storebyrealm = new Map()

/** @module store */

/**
 *  @param {object} c - our call object.
 *  @param {string} c.uuid - uuid of the call
 *  @param {object} c.sip
 *  @param {string} c.sip.callid - the call id string
 */
function iscallobjectgood( c ) {
  if( "object" !== typeof c ) return false
  if( "string" !== typeof c.uuid || 0 === c.uuid.length ) return false
  if( "object" !== typeof c.sip || "string" !== typeof c.sip.callid || 0 === c.sip.callid.length ) return false

  return true
}

/**
 * 
 *  @param {object} c - our call object.
 *  @param {string} c.uuid - uuid of the call
 *  @param {object} c.sip
 *  @param {string} c.sip.callid - the call id string 
 */
function addtocallidset( c ) {

  const callidset = storebycallid.get( c.sip.callid )
  if( callidset ) {
    callidset.add( c )
  } else {
    const s = new Set()
    s.add( c )
    storebycallid.set( c.sip.callid, s )
  }
}

/**
 * 
 *  @param {object} c - our call object.
 *  @param {string} c.uuid - uuid of the call
 *  @param {object} c.sip
 *  @param {string} c.sip.callid - the call id string 
 */
function deletefromcallidset( c ) {
  const callid = c.sip.callid

  const callidset = storebycallid.get( callid )
  if( undefined !== callidset ) {
    callidset.delete( c )

    if( 0 === callidset.size ) {
      storebycallid.delete( callid )
    }
  }
}

/**
 * 
 * @param { object } c
 * @param { object } c._entity
 * @param { object } [ c._entity.uri ]
 * @param { object } [ c._entity.username ]
 * @param { object } [ c._entity.realm ]
 * @return { object | boolean } returns boolean if no further processing or entity object
 */
function fixentity( c ) {

  const entity = c._entity
  if( !entity ) return true

  if( !entity.uri && entity.username && entity.realm ) {
    entity.uri = entity.username + "@" + entity.realm
  }

  if( entity.uri && !entity.username ) {
    entity.username = entity.uri.split( "@" ).shift()
  }

  if( entity.uri && !entity.realm ) {
    entity.realm = entity.uri.split( "@" ).pop()
  }

  return entity
}

/**
 *  This can be called multiple times for the same call to store or update. Stores a
 *  call object in our store.
 *  @param { object } c - our call object.
 *  @param { string } c.uuid - uuid of the call
 *  @param { object } c.sip
 *  @param { string } c.sip.callid - the call id string
 *  @param { object } c.sip.tags - the local and remote tags
 *  @param { string } c.sip.tags.local - the local tag
 *  @param { string } c.sip.tags.remote - the remote tag
 *  @param { object } c._entity
 *  @param { object } [ c._entity.uri ]
 *  @param { object } [ c._entity.username ]
 *  @param { object } [ c._entity.realm ]
 *  @param { object } c.destination
 *  @param { object } [ c._state ]
 *  @param { boolean } [ c._state._hangup ]
 *  @return { Promise } - which resolves on completion (for future in case we support redis or similar)
 */
module.exports.set = async ( c ) => {
  if( !iscallobjectgood( c ) ) return false
  if( c._state && c._state._hangup ) {
    module.exports.delete( c )
    return false
  }

  storebyuuid.set( c.uuid, c )
  addtocallidset( c )

  let realm = ""
  const destination = c.destination
  if( destination ) realm = c.destination.host

  const entity = fixentity( c )
  if( "boolean" !== typeof entity ) {

    let storedentity = storebyentity.get( entity.uri )
    if( !storedentity ) {
      storedentity = new Map()
      storebyentity.set( entity.uri, storedentity )
    }

    storedentity.set( c.uuid, c )
    realm = entity.realm
  }

  if( !realm ) return true

  let storedentityrealm = storebyrealm.get( realm )
  if( !storedentityrealm ) {
    storedentityrealm = new Map()
    storebyrealm.set( realm, storedentityrealm )
  }
  storedentityrealm.set( c.uuid, c )

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
 *  Retreive call object by realm.
 *  @param {string} realm - the entity realm
 *  @return {Promise} which resolves to either a set containing calls for this entity or undefined
 */
async function getbyrealm( realm ) {
  if( !storebyrealm.has( realm ) ) return false
  return storebyrealm.get( realm )
}

/* backwards compat - is now realm more generally */
module.exports.getbyrealm = getbyrealm
module.exports.getbyentityrealm = getbyrealm

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
  const callidset = storebycallid.get( sip.callid )
  if( undefined === callidset ) return false

  for( const c of callidset ) {

    if( sip.callid !== c.sip.callid ) continue
    if( "" !== c.sip.tags.local && c.sip.tags.local !== sip.tags.local ) continue
    if( "" !== c.sip.tags.remote && c.sip.tags.remote !== sip.tags.remote ) continue

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

  if( !iscallobjectgood( c ) ) return false
  storebyuuid.delete( c.uuid )

  deletefromcallidset( c )

  let realm = ""
  const destination = c.destination
  if( destination ) realm = c.destination.host

  const entity = fixentity( c )
  if( "boolean" !== typeof entity ) {
    const entityentries = storebyentity.get( entity.uri )
    if( undefined !== entityentries ) {
      entityentries.delete( c.uuid )
      if( 0 === entityentries.size ) {
        storebyentity.delete( entity.uri )
      }
    }
    realm = entity.realm
  }

  const storedrealm = storebyrealm.get( realm )
  if( storedrealm ) {
    storedrealm.delete( c.uuid )
    if( 0 === storedrealm.size ) {
      storebyrealm.delete( entity.realm )
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
  storebyrealm = new Map()
}

/**
 *  Return stats for testing etc.
 */
module.exports.stats = async () => {
  return {
    "storebycallid": storebycallid.size,
    "storebyuuid": storebyuuid.size,
    "storebyentity": storebyentity.size,
    "storebyrealm": storebyrealm.size
  }
}

/**
 * Debug only
 */
module.exports._dump = () => {
  console.log( storebycallid, storebyuuid, storebyentity, storebyrealm ) 
}
