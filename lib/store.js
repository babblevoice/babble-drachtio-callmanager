

const storebycallid = new Map()
const storebyuuid = new Map()
const storebyentity = new Map()

/* This can be called multiple times for the same call to update */
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

module.exports.getbyentity = ( entity ) => {
  return new Promise( ( resolve, reject ) => {
    if( !storebyentity.has( entity ) ) {
      reject()
    } else {
      resolve( storebyentity.get( entity ) )
    }
  } )
}

/* sip is required to have:
{
  callid: "<callid>",
  tags:{
    local: "<tag>",
    remote: "<tag>"
  }
}
*/
module.exports.getbycallid = ( sip ) => {
  return new Promise( ( resolve, reject ) => {
    let callidset = storebycallid.get( sip.callid )
    if( undefined === callidset ) {
      reject( "No call matching replaces" )
    } else {
      for( let c of callidset ) {

        if( sip.callid !== c.sip.callid ) continue
        if( c.sip.tags.local !== "" && c.sip.tags.local !== sip.tags.local ) continue
        if( c.sip.tags.remote !== "" && c.sip.tags.remote !== sip.tags.remote ) continue

        resolve( c )
        return
      }

      reject( "No matching tags for call" )
    }
  } )
}

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

module.exports.stats = () => {
  return {
    "storebycallid": storebycallid.size,
    "storebyuuid": storebyuuid.size,
    "storebyentity": storebyentity.size
  }
}
