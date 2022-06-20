
const expect = require( "chai" ).expect
const callmanager = require( "../../index.js" )
const call = require( "../../lib/call.js" )
const srf = require( "../mock/srf.js" )
const projectrtp = require( "@babblevoice/projectrtp" ).projectrtp

/* These DO NOT form part of our interface */
const clearcallmanager = require( "../../lib/callmanager.js" )._clear
const callstore = require( "../../lib/store.js" )

describe( "hold", function() {

  afterEach( function() {
    clearcallmanager()
  } )

  beforeEach( function() {
    clearcallmanager()
  } )

  it( `place call on hold - inactive`, async function() {
    let srfscenario = new srf.srfscenario()

    let call = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    let eventreceived = false
    call.on( "call.hold", ( anotherreftocall ) => {
      eventreceived = true
    } )

    await call.answer()

    let req = new srf.req( new srf.options() )
    let res = new srf.res()

    let sipcodesent, msgsent
    res.onsend( ( sipcode, msg ) => {
      sipcodesent = sipcode
      msgsent = msg
    } )

    req.msg.body = `v=0
o=- 1608235282228 0 IN IP4 127.0.0.1
s=
c=IN IP4 192.168.0.141
t=0 0
m=audio 20000 RTP/AVP 97 101
a=rtpmap:97 ilbc/8000
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=fmtp:97 mode=20
a=inactive`.replace(/(\r\n|\n|\r)/gm, "\r\n")

    call._dialog.callbacks.modify( req, res )

    await call.hangup()

    expect( eventreceived ).to.be.true
    expect( sipcodesent ).to.equal( 200 )
    expect( msgsent.headers.Subject ).to.equal( "Call on hold" )
    expect( msgsent.body ).to.include( "a=inactive" )
  } )

  it( `place call off hold - inactive`, async function() {
    let srfscenario = new srf.srfscenario()

    let call = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    let eventreceived = false
    call.on( "call.unhold", ( anotherreftocall ) => {
      eventreceived = true
    } )

    await call.answer()

    let req = new srf.req( new srf.options() )
    let res = new srf.res()

    req.msg.body = `v=0
o=- 1608235282228 0 IN IP4 127.0.0.1
s=
c=IN IP4 192.168.0.141
t=0 0
m=audio 20000 RTP/AVP 97 101
a=rtpmap:97 ilbc/8000
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=fmtp:97 mode=20
a=inactive`.replace(/(\r\n|\n|\r)/gm, "\r\n")

    call._dialog.callbacks.modify( req, res )

    let sipcodesent, msgsent
    res.onsend( ( sipcode, msg ) => {
      sipcodesent = sipcode
      msgsent = msg
    } )

    req.msg.body = `v=0
o=- 1608235282228 0 IN IP4 127.0.0.1
s=
c=IN IP4 192.168.0.141
t=0 0
m=audio 20000 RTP/AVP 97 101
a=rtpmap:97 ilbc/8000
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=fmtp:97 mode=20
a=sendrecv`.replace(/(\r\n|\n|\r)/gm, "\r\n")

    call._dialog.callbacks.modify( req, res )

    await call.hangup()

    expect( eventreceived ).to.be.true
    expect( sipcodesent ).to.equal( 200 )
    expect( msgsent.headers.Subject ).to.equal( "Call off hold" )
    expect( msgsent.body ).to.include( "a=sendrecv" )
  } )


  it( `place call on hold - 0.0.0.0`, async function() {
    let srfscenario = new srf.srfscenario()

    let call = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    let eventreceived = false
    call.on( "call.hold", ( anotherreftocall ) => {
      eventreceived = true
    } )

    await call.answer()

    let req = new srf.req( new srf.options() )
    let res = new srf.res()

    let sipcodesent, msgsent
    res.onsend( ( sipcode, msg ) => {
      sipcodesent = sipcode
      msgsent = msg
    } )

    req.msg.body = `v=0
o=- 1608235282228 0 IN IP4 127.0.0.1
s=
c=IN IP4 0.0.0.0
t=0 0
m=audio 20000 RTP/AVP 97 101
a=rtpmap:97 ilbc/8000
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=fmtp:97 mode=20
a=sendrecv`.replace(/(\r\n|\n|\r)/gm, "\r\n")

    call._dialog.callbacks.modify( req, res )

    await call.hangup()

    expect( eventreceived ).to.be.true
    expect( sipcodesent ).to.equal( 200 )
    expect( msgsent.headers.Subject ).to.equal( "Call on hold" )
    expect( msgsent.body ).to.include( "a=inactive" )
  } )
} )
