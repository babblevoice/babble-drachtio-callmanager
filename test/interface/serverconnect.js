
const prtp = require( "@babblevoice/projectrtp" )
const node = require( "@babblevoice/projectrtp/lib/node" )
const expect = require( "chai" ).expect
const call = require( "../../lib/call" )

/**
 * Test file to run tests acting as a remote note. Starts a babble-rtp node in the background
 * before any tests begin then runs tests to open, play, polly etc.
 */
describe( "server connect interface", () => {

  before( async () => {
    const host = "127.0.0.1"
    const port = 9002
    await prtp.projectrtp.node.listen( host, port )
    prtp.projectrtp.server.addnode( { host, port} )
    
  } )

  after( () => {
    prtp.projectrtp.server.clearnodes()
    node.interface.destroy()
  } )

  /**
   * Primarily testing waitforanyevent and related event handling functions.
   */
  it( "server connect and open channel", async function () {
    this.timeout( 7000 )
    this.slow( 5000 )

    const totalotherchannelcount = 100
    let chanclosecount = 0
    let allchannelsclosedresolve
    const allchannelsclosed = new Promise( resolve => allchannelsclosedresolve = resolve )
    const onclose = ( e ) => {
      if( "close" == e.action ) chanclosecount++
      if( totalotherchannelcount == chanclosecount ) allchannelsclosedresolve()
    }

    // A very short wav file
    prtp.projectrtp.tone.generate( "350+440*0.5:100", "/tmp/serverconnecttestwavghghgh.wav" )
    prtp.projectrtp.tone.generate( "350+440*0.5:100", "/tmp/otherserverconnecttestwavghhh.wav" )

    const channels = []
    for( let i = 0; totalotherchannelcount > i; i++ ) {
      channels.push( await prtp.projectrtp.openchannel( onclose ) )
    }

    for( let i = 0; 3 > i; i++ ) {
      const ourcall = new call()
  
      const chan = await prtp.projectrtp.openchannel( ourcall._handlechannelevents.bind( ourcall ) )

      ourcall._em.on( "channel", ( e ) => {
        /* For this test we don't want the call object to run our hangup 
        handlers as they are  more complex than we are trying to test here */
        if( "close" == e.event.action ) e.event.action = ""
       } )
  
      chan.play( { "interupt":true, "files": [ { "wav": "/tmp/serverconnecttestwavghghgh.wav" }, { "wav": "/tmp/otherserverconnecttestwavghhh.wav" } ] } )

      await ourcall.waitforanyevent( { "action": "play", "event": "start", "reason": "new" } )
      await ourcall.waitforanyevent( { "action": "play", "event": "end", "reason": /^((?!replaced).)*$/ } )

      chan.close()
    }

    for( const chan of channels ) {
      chan.close()
    }

    if( 0 != totalotherchannelcount )
    await allchannelsclosed
    expect( chanclosecount ).to.equal( totalotherchannelcount )
  } )

} )