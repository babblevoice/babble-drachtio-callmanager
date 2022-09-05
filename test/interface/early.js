

const { v4: uuidv4 } = require( "uuid" )
const expect = require( "chai" ).expect
const callmanager = require( "../../index.js" )
const call = require( "../../lib/call.js" )
const srf = require( "../mock/srf.js" )

const projectrtpmessage = require( "@babblevoice/projectrtp/lib/message.js" )
const net = require( "net" )

const clearcallmanager = require( "../../lib/callmanager.js" )._clear

describe( "call early", function() {

  afterEach( function() {
    clearcallmanager()
  } )

  beforeEach( function() {
    clearcallmanager()
  } )


  it( `Create call and send 183 - early`, async () => {
    let srfscenario = new srf.srfscenario()

    let rtpserver = callmanager.projectrtp.proxy.listen()

    let connection = net.createConnection( 9002, "127.0.0.1" )
      .on( "error", ( e ) => {
        console.error( e )
      } )

    connection.on( "connect", () => {
      /* announce our node */
      connection.write( projectrtpmessage.createmessage( {"status":{"channel":{"available":5000,"current":0},"workercount":12,"instance":"ca0ef6a9-9174-444d-bdeb-4c9eb54d4566"}} ) )
    } )

    let msgid
    let mixing
    let messagestate = projectrtpmessage.newstate()
    connection.on( "data", ( data ) => {
      projectrtpmessage.parsemessage( messagestate, data, ( msg ) => {
        if( "open" === msg.channel ) {
          msgid = msg.id
          setTimeout( () => connection.write( projectrtpmessage.createmessage( {"local":{"port":10008,"dtls":{"fingerprint":"Some fingerprint","enabled":false},"address":"192.168.0.141"},"id": msg.id, "uuid": uuidv4(),"action":"open","status":{"channel":{"available":4995,"current":5},"workercount":12,"instance":"ca0ef6a9-9174-444d-bdeb-4c9eb54d4566"}} ) ), 2 )
        } else if ( "close" === msg.channel ) {
          connection.write( projectrtpmessage.createmessage( {"id": msg.id,"uuid":msg.uuid,"action":"close","reason":"requested","stats":{"in":{"mos":4.5,"count":586,"dropped":0,"skip":0},"out":{"count":303,"skip":0},"tick":{"meanus":124,"maxus":508,"count":597}}} ) )
        } else if ( "mix" === msg.channel ) {
          mixing = true
        }
      } )
    } )

    /* ensure we are connected */
    await new Promise( ( r ) => setTimeout( () => r(), 100 ) )

    srfscenario.oncreateUAC( async ( contact, options, callbacks ) => {
      callbacks.cbProvisional( {
        "status": 183,
        "msg": {
          "body": `v=0
o=- 1608235282228 0 IN IP4 127.0.0.1
s=
c=IN IP4 192.168.0.141
t=0 0
m=audio 20000 RTP/AVP 0 101
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=sendrecv`.replace(/(\r\n|\n|\r)/gm, "\r\n")
        }
      } )

      await new Promise( ( r ) => setTimeout( () => r(), 100 ) )
      throw { "status": 503 }
    } )

    let msgsent
    let call = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
      srfscenario.res.onsend( (c) => {
        msgsent = c
      })
    } )


    let newcall = await call.newuac( { "contact": "callto" } )
    
    await call._onhangup( "wire" )
    
    expect( newcall.state.early ).to.be.true
    expect( call.state.early ).to.be.true
    expect( mixing ).to.be.true
    expect( msgsent ).to.equal( 183 )

    connection.destroy()
    rtpserver.destroy()
  } )

} )