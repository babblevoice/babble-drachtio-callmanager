
const expect = require( "chai" ).expect
const srf = require( "../mock/srf.js" )

describe( "call.js", function() {

  it( "set remote name and id", async function() {
    const srfscenario = new srf.srfscenario()

    let newcallcalled = false
    srfscenario.options.em.on( "call.new", ( /*newcall*/ ) => {
      newcallcalled = true
    } )

    const call = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    call.calleridname = "foo"
    call.callerid = "123456789"

    // TODO we set the remote id using "setremoteid", but getter returns it as "user" 
    // the names mismatch and can be confusing, we might consider some polishing here?
    expect(call.callerid.name).equals("foo")
    expect(call.callerid.user).equals("123456789")
    expect( newcallcalled ).to.be.true

    await call.hangup()
  } )

} )
