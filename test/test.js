
const assert = require( "assert" )
const callstore = require( "../lib/store.js" )


async function teststore() {
  let dummycall1 = {
    "source_address": "127.0.0.1",
    "sip": {
      "callid": "1234"
    }
  }

  let dummycall2 = {
    "source_address": "127.0.0.1",
    "sip": {
      "callid": "12345"
    }
  }

  let dummycall3 = {
    "source_address": "127.0.0.2",
    "sip": {
      "callid": "12345"
    }
  }

  callstore.set( dummycall1 )
  callstore.set( dummycall2 )
  console.log( callstore.stats() )

  dummycall1.entity = "1000@bling.babblevoice.com"
  callstore.set( dummycall1 )
  callstore.set( dummycall3 )
  console.log( callstore.stats() )

  await callstore.getbysourceandcallid( dummycall1.source_address, dummycall1.sip.callid )
    .then( ( c ) => {
      console.log( "Wahoo, retreived call" )
      console.log( c )
    } )
    .catch( () => {
      assert( "Uh oh..." )
    } )

  callstore.delete( dummycall1 )
  callstore.delete( dummycall2 )
  callstore.delete( dummycall3 )
  let finishstats = callstore.stats()

  assert( 0 === finishstats.storebysourceaddressandcallid )
  assert( 0 === finishstats.storebyuuid )
  assert( 0 === finishstats.storebyentity )

  console.log( finishstats )
}

teststore()
