

const sdptransform = require( "sdp-transform" )
const crypto = require( "crypto" )

/*
  An SDP Generator.
*/
var sessionidcounter = Math.floor( Math.random() * 100000 )

const codecconv = {
  "0": "pcmu",
  "8": "pcma",
  "9": "g722",
  "97": "ilbc",
  "101": "2833"
}
const codecrconv = {
  "pcmu": 0,
  "pcma": 8,
  "g722": 9,
  "ilbc": 97,
  "2833": 101
}

const codecdefs = {
  "type": {
    "pcmu": "audio",
    "pcma": "audio",
    "g722": "audio",
    "ilbc": "audio",
    "2833": "audio",
  },
  "rtp": {
    "pcmu": {
      payload: 0,
      codec: 'PCMU',
      rate: 8000
    },
    "pcma": {
      payload: 8,
      codec: 'PCMA',
      rate: 8000
    },
    "g722": {
      payload: 9,
      codec: 'G722',
      rate: 8000
    },
    "ilbc": {
      payload: 97,
      codec: 'ilbc',
      rate: 8000
    },
    "2833": {
      payload: 101,
      codec: 'telephone-event/8000'
    }
  },
  "fmtp": {
    "ilbc": {
      payload: 97,
      config: "mode=20"
    },
    "2833": {
      payload: 101,
      config: "0-16"
    } /* 0-16 = DTMF */
  }
}

const defaultaudiomedia = {
  "rtp": [],
  "fmtp": [],
  "type": "audio",
  "port": 0,
  "protocol": "RTP/AVP",
  "payloads": [],
  "ptime": 20,
  "direction": "sendrecv"
}

class sdp {

  constructor( sdp ) {

    if ( undefined === sdp ) {
      sessionidcounter = ( sessionidcounter + 1 ) % 4294967296

      this.sdp = {
        version: 0,
        origin: {
          username: '-',
          sessionId: sessionidcounter,
          sessionVersion: 0,
          netType: 'IN',
          ipVer: 4,
          address: "127.0.0.1"
        },
        name: 'project',
        timing: {
          start: 0,
          stop: 0
        },
        connection: {
          version: 4,
          ip: "127.0.0.1"
        },
        //iceUfrag: 'F7gI',
        //icePwd: 'x9cml/YzichV2+XlhiMu8g',
        //fingerprint:
        // { type: 'sha-1',
        //   hash: '42:89:c5:c6:55:9d:6e:c8:e8:83:55:2a:39:f9:b6:eb:e9:a3:a9:e7' },
        media: [ {
          rtp: [],
          fmtp: [],
          type: "audio",
          port: 0,
          protocol: "RTP/AVP",
          payloads: [],
          ptime: 20,
          direction: "sendrecv"
        } ]
      }
    } else {

      this.sdp = sdptransform.parse( sdp )

      /* Convert payloads to something more consistent. Always an array of Numbers */
      this.sdp.media.forEach( ( media, i, a ) => {

        if ( "audio" === media.type ) {
          if ( typeof media.payloads === "string" ) {
            media.payloads = media.payloads.split( /[ ,]+/ )
          }

          if ( !Array.isArray( media.payloads ) ) {
            a[ i ].payloads = [ media.payloads ]
          }

          media.payloads.forEach( ( v, vi, va ) => va[ vi ] = Number( v ) )
        }
      } )
    }
  }

  /*
  Used by our rtpchannel to get the port and address information (and codec).
  Ideally we replicate the object required for target in our RTP service.
  */
  getaudio() {
    let m = this.sdp.media.find( mo => "audio" === mo.type )

    if ( m ) {

      let payloads = m.payloads
      if ( this.selected !== undefined ) {
        payloads = [ this.selected ]
      }

      let address
      let port = m.port
      if ( m.candidates ) {
        for( const c of m.candidates ) {
          /*
          {
            foundation: 842238307,
            component: 1,
            transport: 'udp',
            priority: 2113937151,
            ip: '2dcfedf6-d4e8-4a56-a0b6-efb390be339d.local',
            port: 48245,
            type: 'host',
            generation: 0,
            'network-cost': 999
          }
          */
          if( !c.ip.endsWith( ".local" ) ) {

          }
          address = c.ip
          port = c.port
        }
        console.log( m.candidates )
      }
      

      if( !address ) {
        if( this.sdp.connection ) address = this.sdp.connection.ip
        else if( this.sdp.origin.address ) address = this.sdp.origin.address
      }
      

      return {
        "port": port,
        "address": address,
        "audio": {
          "payloads": payloads
        }
      }
    }
    return false
  }

  /*
  select works in conjunction with getaudioremote and allows us to force the
  selection of the codec we send to our RTP server. This is used on the offered SDP.
  If intersect has been called with firstonly flag set then this has the same effect.
  */
  select( codec ) {
    if ( isNaN( codec ) ) {
      if ( undefined === codecrconv[ codec ] ) return
      codec = codecrconv[ codec ]
    }
    this.selected = Number( codec )

    return this
  }

  static create( from ) {
    return new sdp( from )
  }

  setsessionid( i ) {
    this.sdp.origin.sessionId = i
    return this
  }

  setconnectionaddress( addr ) {
    this.sdp.connection.ip = addr
    return this
  }

  setoriginaddress( addr ) {
    this.sdp.origin.address = addr
    return this
  }

  setaudioport( port ) {
    this.getmedia().port = port
    return this
  }

  getmedia( type = "audio" ) {
    let m = this.sdp.media.find( mo => type === mo.type )
    if ( !m ) {
      this.sdp.media.push( defaultaudiomedia )
      m = this.sdp.media[ this.sdp.media.length - 1 ]
    }

    return m
  }

  setaudiodirection( direction /* sendrecv|inactive|sendonly|recvonly */ ) {
    this.getmedia().direction = direction
  }

  /*
  Add a CODEC or CODECs, formats:
  "pcma"
  "pcma pcmu"
  "pcma, pcmu"
  [ "pcma", pcmu ]
  */
  addcodecs( codecs ) {
    let codecarr = codecs
    if ( !Array.isArray( codecarr ) && "string" === typeof codecs ) {
      codecarr = codecs.split( /[ ,]+/ )
    } else {
      codecarr = []
    }

    codecarr.forEach( codec => {
      let codecn = codecrconv[ codec ]
      let def = codecdefs.rtp[ codec ]
      if ( undefined !== def ) {
        /* suported audio */
        let m = this.getmedia( codecdefs.type[ codec ] )

        /* Don't allow duplicates */
        if( m.payloads.includes( codecn ) ) return

        m.rtp.push( def )
        m.payloads.push( def.payload )

        if ( undefined !== codecdefs.fmtp[ codec ] ) {
          m.fmtp.push( codecdefs.fmtp[ codec ] )
        }
      }
    } )

    return this
  }

  /**
   * Add SSRC to each media entry. This ties together multiple streams in one
   * which will be important when we add video.
   * @param { string } ssrc string representing the ssrc
   */
  addssrc( ssrc ) {
    this.sdp.msidSemantic = { 
      "semantic": "WMS", 
      "token": crypto.randomBytes( 16 ).toString( "hex" )
    }

    for( const m of this.sdp.media ) {
      let mmsid = crypto.randomBytes( 16 ).toString( "hex" )
      m.ssrcs = [
        { "id": ssrc, "attribute": "cname", "value": crypto.randomBytes( 16 ).toString( "hex" ) },
        { "id": ssrc, "attribute": "msid", "value": this.sdp.msidSemantic.token + " " + mmsid },
        { "id": ssrc, "attribute": "mslabel", "value": this.sdp.msidSemantic.token },
        { "id": ssrc, "attribute": "label", "value": mmsid }
      ]

      m.msid = m.ssrcs[ 1 ].value
    }

    return this
  }

  /**
   * Configures the SDP for DTLS (WebRTC).
   * Limitation is it requires the same fingerprint for each connection
   * TODO - seperate each media connection for different fingerprints.
   * @param { string } fingerprint - i.e. "D3:55:21:F4..."
   * @param { string } actpass - "active|passive|actpass"
   */
  secure( fingerprint, actpass ) {
    for( const m of this.sdp.media ) {
      m.protocol = "UDP/TLS/RTP/SAVPF"
      m.fingerprint = {
        "type": "sha-256",
        "hash": fingerprint
      }
      m.setup = actpass
    }

    return this
  }

  /**
   * Adds ICE candidate to SDP
   */
  addicecandidates( ip, port, icepwd ) {
    for( const m of this.sdp.media ) {
      m.candidates = [ {
        "foundation": 1, /* RFC 5245 4.1.1.3 */
        "component": 1,
        "transport": "udp",
        "priority": 255, /* RFC 5245 4.1.2 & 4.1.2.1 - we only have 1 candidate */
        "ip": ip,
        "port": port,
        "type": "host",
        "generation": 0
        }
      ]

      m.iceUfrag = crypto.randomBytes( 8 ).toString( "hex" )
      m.icePwd = icepwd
    }

    return this
  }

  rtcpmux( v = true ) {
    for( const m of this.sdp.media ) {
      m.rtcpMux = "rtcp-mux"
    }
    return this
  }

  clearcodecs() {

    this.sdp.media.forEach( m => {
      m.payloads = []
      m.rtp = []
      m.fmtp = []
    } )

    return this
  }

  /*
  Only allow CODECs supported by both sides.
  other can be:
  "pcma pcmu ..."
  "pcma,pcmu"
  "0,8"
  "0 8"
  [ "pcma", "pcmu" ]
  [ 0, 8 ]

  Returns a codec string
  "pcma pcmu"

  If first ony, it only returns the first match
  */
  intersection( other, firstonly = false ) {
    if ( typeof other === "string" ) {
      other = other.split( /[ ,]+/ )
    }

    /* convert to payloads */
    other.forEach( ( codec, i, a ) => {
      if ( isNaN( codec ) ) {
        a[ i ] = codecrconv[ codec ]
      }
    } )

    /* Does it exist in payloads and fmtp where required */
    let retval = []
    this.sdp.media.forEach( m => {
      retval = retval.concat( other.filter( pl => {
        if ( m.payloads.includes( pl ) ) {
          let codecname = codecconv[ pl ]
          if ( undefined === codecdefs.fmtp[ codecname ] ) return true

          let fmtp = codecdefs.fmtp[ codecname ] /* i.e. { payload: 97, config: "mode=20" } */
          if ( undefined !== m.fmtp.find( f => f.payload == fmtp.payload && f.config == fmtp.config ) ) return true
        }
        return false
      } ) )
    } )

    if ( firstonly && retval.length > 0 ) {
      retval = [ retval[ 0 ] ]
      this.select( retval[ 0 ] )
    }

    /* We want named codecs */
    retval.forEach( ( codec, i, a ) => {
      if ( undefined != codecconv[ codec ] ) a[ i ] = codecconv[ codec ]
    } )

    return retval.join( " " )
  }

  toString() {

    /* We need to convert payloads back to string to stop a , being added */
    let co = Object.assign( this.sdp )

    co.media.forEach( ( media, i, a ) => {
      if( Array.isArray( media.payloads ) ) {
        a[ i ].payloads = media.payloads.join( " " )
      }
    } )

    return sdptransform.write( co )
  }
}

module.exports = sdp
