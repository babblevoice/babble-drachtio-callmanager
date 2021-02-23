
const assert = require( "assert" )
const callstore = require( "../lib/store.js" )


async function teststore() {
  let dummycall1 = {
    "uuid": "1",
    "sip": {
      "callid": "1234",
      "tags": {
        "local": "",
        "remote": "1111"
      }
    }
  }

  let dummycall2 = {
    "uuid": "2",
    "sip": {
      "callid": "12345",
      "tags": {
        "local": "",
        "remote": "1234"
      }
    }
  }

  let dummycall3 = {
    "uuid": "3",
    "sip": {
      "callid": "12345",
      "tags": {
        "local": "",
        "remote": "4321"
      }
    }
  }

  callstore.set( dummycall1 )
  callstore.set( dummycall2 )
  console.log( callstore.stats() )

  dummycall1.entity = "1000@bling.babblevoice.com"
  callstore.set( dummycall1 )
  callstore.set( dummycall3 )
  console.log( callstore.stats() )

  await callstore.getbycallid( dummycall1.sip )
    .then( ( c ) => {
      console.log( c )
      assert( c.uuid === "1" )
      console.log( "Wahoo, retreived call" )
    } )
    .catch( () => {
      assert( false, "Uh oh..." )
    } )

  callstore.delete( dummycall1 )
  callstore.delete( dummycall2 )
  callstore.delete( dummycall3 )
  let finishstats = callstore.stats()

  assert( 0 === finishstats.storebycallid )
  assert( 0 === finishstats.storebyuuid )
  assert( 0 === finishstats.storebyentity )

  console.log( finishstats )
}

teststore()
