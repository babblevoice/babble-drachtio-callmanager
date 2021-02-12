

const storebysourceaddressandcallid = new Map()
const storebyuuid = new Map()
const storebyentity = new Map()

/* This can be called multiple times for the same call to update */
module.exports.set = ( c ) => {

  storebyuuid.set( c.uuid, c )

  let source = c.source_address
  let callid = c.sip.callid

  let bycallid = storebysourceaddressandcallid.get( source )
  if( undefined === bycallid ) {
    bycallid = new Map()
    storebysourceaddressandcallid.set( source, bycallid )
  }

  bycallid.set( callid, c )


  if( undefined !== c.entity ) {
    let entities = storebyentity.get( c.entity )
    if( undefined === entities ) {
      entities = new Set()
      storebyentity.set( c.entity, entities )
    }

    entities.add( c )
  }
}

module.exports.storebyentity = ( c, entity ) => {

}

module.exports.getbyentity = ( entity ) => {
  return new Promise( ( resolve, reject ) => {
  } )
}

module.exports.getbysourceandcallid = ( source, callid ) => {
  return new Promise( ( resolve, reject ) => {
    let bycallid = storebysourceaddressandcallid.get( source )
    if( undefined === bycallid ) reject()

    let c = bycallid.get( callid )
    if( undefined === c ) reject()
    resolve( c )
  } )
}

module.exports.delete = function( c ) {
  storebyuuid.delete( c.uuid )

  let source = c.source_address
  let callid = c.sip.callid

  if( storebysourceaddressandcallid.has( source ) ) {
    let bysource = storebysourceaddressandcallid.get( source )
    bysource.delete( callid )

    if( 0 === bysource.size ) {
      storebysourceaddressandcallid.delete( source )
    }
  }

  if( undefined !== c.entity ) {
    let entities = storebyentity.get( c.entity )
    if( undefined !== entities ) {
      entities.delete( c )
    }

    if( 0 === entities.size ) {
      storebyentity.delete( c.entity )
    }
  }
}

module.exports.stats = () => {
  return {
    "storebysourceaddressandcallid": storebysourceaddressandcallid.size,
    "storebyuuid": storebyuuid.size,
    "storebyentity": storebyentity.size
  }
}
