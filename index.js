

'use strict'

const assert = require( "assert" )
const events = require('events')
const digestauth = require( "drachtio-mw-digest-auth" )
const regparser = require( "drachtio-mw-registration-parser" )
const parseuri = require( "drachtio-srf" ).parseUri

/* RTP */
const projectrtp = require( "babble-projectrtp" ).ProjectRTP
const sdpgen = require( "babble-projectrtp" ).sdp

const rtp = new projectrtp()

class call {
  constructor( req, res ) {
    this.req = req
    this.res = res
    this.type = "uas"

    /* an array of channels */
    this.chs = []
  }

  get destination() {
    return parseuri( this.req.msg.uri )
  }

  /*
    auth - returns promise.
  */
  auth() {
    var p = new Promise( ( resolve, reject ) => {
      this.authresolve = resolve
      this.authreject = reject
    } )

    var authed = false
    singleton.authdigest( this.req, this.res, () => { authed = true } )
    if( !authed ) {
      return p
    }

    this.authresolve()
    return p
  }

  ring() {
    this.res.send( 180 )
  }

  busy() {
    this.res.send( 486 )
  }

  /*
    answer - returns promise.
    Answer the call and store a channel which can be used.
  */
  answer() {
    var p = new Promise( ( resolve, reject ) => {
      this.answerresolve = resolve
      this.answerreject = reject
    } )

    let remotesdp = sdpgen.create( this.req.msg.body )
    let remotecodecs = remotesdp.intersection( singleton.options.preferedcodecs )
    console.log( "Other leg has compatible codecs: " + remotecodecs )

    rtp.channel( remotesdp )
      .then( ch => {

        this.chs.push( ch )

        let localsdp = sdpgen.create().addcodecs( remotecodecs ).setchannel( ch )

        singleton.options.srf.createUAS( this.req, this.res, {
          localSdp: localsdp.toString()
        } )
        .then( ( dialog ) => {
          this.dialog = dialog
          this.addevents( this.dialog )
          this.answerresolve()
        } )
        .catch( ( err ) => { this.answerreject() } )
      } )

    return p
  }

  addevents( dialog ) {
    dialog.on( "destroy", ( req ) => {
      this.channels( ( ch ) => ch.destroy() )
    } )

    dialog.on( "hold", ( req ) => {

    } )

    dialog.on( "unhold", ( req ) => {

    } )

    dialog.on( "refer", ( req, res ) => {

    } )

    dialog.on( "modify", ( req, res ) => {
      //  The application must respond, using the res parameter provided.
    } )
  }

  channels( cb ) {
    this.chs.forEach( ( ch ) => cb( ch ) )
    return this
  }

  hangup() {
    // TODO
    this.req.destroy()
  }

  newcall() {

  }
}

var singleton
class callmanager {
  constructor( options ) {
    singleton = this

    this.options = {
      "preferedcodecs": "pcmu pcma 2833",
      "transcode": true
    }

    this.options = { ...this.options, ...options }

    this.authdigest = digestauth( {
      proxy: true, /* 407 or 401 */
      passwordLookup: options.passwordLookup
    } )

    this.options.srf.use( "invite", this.oninvite )

    this.em = new events.EventEmitter()
  }

  on( event, cb ) {
    this.em.on( event, cb )
  }

  oninvite( req, res, next ) {
    if ( req.method !== "INVITE" ) return next()

    singleton.em.emit( "call", new call( req, res ) )

    return next()
  }
}


module.exports = callmanager
