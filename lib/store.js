

const storebycallid = new Map()
const storebyuuid = new Map()
const storebyentity = new Map()

/** @module store */

/**
  This can be called multiple times for the same call to update. Store a
  call object in our store.
  @param {object} c - our call object.
*/
module.exports.set = ( c ) => {

  storebyuuid.set( c.uuid, c )

  let callid = c.sip.callid

  let callidset = storebycallid.get( callid )
  if( undefined === callidset ) {
    let s = new Set()
    s.add( c )
    storebycallid.set( callid, s )
  } else {
    callidset.add( c )
  }

  if( undefined !== c.entity ) {
    let entities = storebyentity.get( c.entity )
    if( undefined === entities ) {
      entities = new Set()
      storebyentity.set( c.entity, entities )
    }

    entities.add( c )
  }
}

/**
  Retreive call object by entity.
  @return {Promise} which resolves to either a set containing calls for this entity or undefined
*/
module.exports.getbyentity = ( entity ) => {
  return new Promise( ( resolve, reject ) => {
    if( !storebyentity.has( entity ) ) {
      resolve()
    } else {
      resolve( storebyentity.get( entity ) )
    }
  } )
}

/**
  Returns a unique call by call id and sip tags.
  @param {object} sip - sip params required
  @param {string} sip.callid - the call id string
  @param {object} sip.tags - the local and remote tags
  @param {string} sip.tags.local - the local tag
  @param {string} sip.tags.remote - the remote tag
  @return {Promise} which resolves to either the unique call object or undefined
*/
module.exports.getbycallid = ( sip ) => {
  return new Promise( ( resolve, reject ) => {
    let callidset = storebycallid.get( sip.callid )
    if( undefined === callidset ) {
      resolve()
    } else {
      for( let c of callidset ) {

        if( sip.callid !== c.sip.callid ) continue
        if( c.sip.tags.local !== "" && c.sip.tags.local !== sip.tags.local ) continue
        if( c.sip.tags.remote !== "" && c.sip.tags.remote !== sip.tags.remote ) continue

        resolve( c )
        return
      }

      resolve()
    }
  } )
}

/**
  Cleanup a call from all of the stores.
  @param {object} c - our call object
*/
module.exports.delete = function( c ) {
  storebyuuid.delete( c.uuid )
  let callid = c.sip.callid

  let callidset = storebycallid.get( callid )
  if( undefined !== callidset ) {
    callidset.delete( c )

    if( 0 === callidset.size ) {
      storebycallid.delete( callid )
    }
  }

  if( undefined !== c.entity ) {
    let entities = storebyentity.get( c.entity )
    if( undefined !== entities ) {
      entities.delete( c )
      if( 0 === entities.size ) {
        storebyentity.delete( c.entity )
      }
    }
  }
}

/**
  Return stats for testing etc.
*/
module.exports.stats = () => {
  return {
    "storebycallid": storebycallid.size,
    "storebyuuid": storebyuuid.size,
    "storebyentity": storebyentity.size
  }
}
