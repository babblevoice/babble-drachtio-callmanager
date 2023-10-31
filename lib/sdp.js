
/**
 * TODO tidy all of teh ts-ignores in favour of defining data structures better.
 */

const sdptransform = require( "sdp-transform" )
const crypto = require( "crypto" )

/*
  An SDP Generator.
*/
let sessionidcounter = Math.floor( Math.random() * 100000 )

class codecconv {

  #pt2name = {
    "0": "pcmu",
    "8": "pcma",
    "9": "g722",
    "97": "ilbc",
    "101": "2833"
  }

  #name2pt = {
    "pcmu": 0,
    "pcma": 8,
    "g722": 9,
    "ilbc": 97,
    "2833": 101
  }

  #defs = {
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
        codec: "PCMU",
        rate: 8000
      },
      "pcma": {
        payload: 8,
        codec: "PCMA",
        rate: 8000
      },
      "g722": {
        payload: 9,
        codec: "G722",
        rate: 8000
      },
      "ilbc": {
        payload: 97,
        codec: "ilbc",
        rate: 8000
      },
      "2833": {
        payload: 101,
        codec: "telephone-event/8000"
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

  /**
   * 
   * @param { "pcma" | "pcmu" | "g722" | "ilbc" | "2833" } name
   * @param { string } codec the codec name as it appears in SDP i.e. "telephone-event" or "G722"
   * @param { number } pt 
   */
  setdynamicpt( name, codec, pt ) {

    for ( const pt2namept in this.#pt2name ) {
      if( codec == this.#pt2name[ pt2namept ] ) {
        delete this.#pt2name[ pt2namept ]
        delete this.#name2pt[ codec ]
        break
      }
    }

    this.#pt2name[ pt ] = name
    this.#name2pt[ codec ] = pt
    this.#defs.rtp[ name ].payload = pt
    this.#defs.fmtp[ name ].payload = pt
  }

  /**
   * 
   * @param { string } pt 
   * @returns { string }
   */
  getcodec( pt ) {
    return this.#pt2name[ pt ]
  }

  /***
   * @param { string } name
   * @returns { string }
   */
  getpt( name ) {
    return this.#name2pt[ name ]
  }

  /**
   * Is it one of our supported codecs
   * @param { string } name
   * @returns { boolean }
   */
  hascodec( name ) {
    return ( name in this.#name2pt )
  }

  /**
   * 
   * @param { string } pt
   * @returns { boolean }
   */
  haspt( pt ) {
    return ( pt in this.#pt2name )
  }

  /**
   * @returns { object }
   */
  get def() {
    return this.#defs
  }

  static create() {
    return new codecconv()
  }
}


function defaultaudiomedia() {
  return {
    "rtp": [],
    "fmtp": [],
    "type": "audio",
    "port": 0,
    "protocol": "RTP/AVP",
    "payloads": [],
    "ptime": 20,
    "direction": "sendrecv"
  }
}

/**
 * 
 * @param { object } audio 
 * @param { number } pt 
 * @returns { string }
 */
function getconfigforpt( audio, pt ) {
  for( const fmtp of audio.fmtp ) {
    if( pt == fmtp.payload ) return fmtp.config
  }
  return ""
}

class sdp {

  #dynamicpts

  constructor( sdp ) {

    /* defaults inc. static */
    this.#dynamicpts = codecconv.create()

    if ( undefined === sdp ) {
      sessionidcounter = ( sessionidcounter + 1 ) % 4294967296

      this.sdp = {
        version: 0,
        origin: {
          username: "-",
          sessionId: sessionidcounter,
          sessionVersion: 0,
          netType: "IN",
          ipVer: 4,
          address: "127.0.0.1"
        },
        name: "project",
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
          if ( "string" === typeof media.payloads ) {
            // @ts-ignore
            media.payloads = media.payloads.split( /[ ,]+/ )
          }

          if ( !Array.isArray( media.payloads ) ) {
            // @ts-ignore
            a[ i ].payloads = [ media.payloads ]
          }

          // @ts-ignore
          media.payloads.forEach( ( v, vi, va ) => va[ vi ] = Number( v ) )

          /* handle our dynamic payloadtypes */
          media.rtp.forEach( ( m ) => {
            switch( m.codec.toLowerCase() ) {
            case "ilbc": {
              if( 8000 == m.rate ) {
                this.#dynamicpts.setdynamicpt( "ilbc", "ilbc", m.payload )
              }
              return
            }
            case "telephone-event": {
              if( 8000 == m.rate ) {
                this.#dynamicpts.setdynamicpt( "2833", "telephone-event", m.payload )
              }
            }
            }
          } )
        }
      } )

    }
  }

  /**
   * Takes a mixed input and outputs an array in the form [ "pcmu", "pcma" ]
   * @param { string | Array<string> } codecarray
   * @return { Array< string >}
   */
  alltocodecname( codecarray ) {

    /* check and convert to array */
    if ( "string" === typeof codecarray ) {
      codecarray = codecarray.split( /[ ,]+/ )
    }

    /* convert to payloads */
    const retval = []
    for( const oin of codecarray ) {
      if( this.#dynamicpts.hascodec( oin ) ) {
        retval.push( oin )
      } else if( this.#dynamicpts.haspt( oin ) ) {
        retval.push( this.#dynamicpts.getcodec( oin ) )
      }
    }

    return retval
  }

  /*
  Used by our rtpchannel to get the port and address information (and codec).
  Ideally we replicate the object required for target in our RTP service.
  */
  getaudio() {
    const m = this.sdp.media.find( mo => "audio" === mo.type )

    if ( m ) {

      let payloads = m.payloads
      if ( this.selected !== undefined ) {
        payloads = [ this.selected ]
      }

      let address
      let port = m.port
      // @ts-ignore
      if ( m.candidates ) {
        // @ts-ignore
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
            address = c.ip
            port = c.port
          }
        }
        /*console.log( m.candidates )*/
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
      if ( undefined === this.#dynamicpts.hascodec( codec ) ) return
      codec = this.#dynamicpts.getcodec( codec )
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
      // @ts-ignore
      this.sdp.media.push( defaultaudiomedia() )
      m = this.sdp.media[ this.sdp.media.length - 1 ]
    }

    return m
  }

  /**
   * 
   * @param { "sendrecv"|"inactive"|"sendonly"|"recvonly" } direction 
   * @returns { object }
   */
  setaudiodirection( direction ) {
    this.getmedia().direction = direction
    return this
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
      const codecn = this.#dynamicpts.getpt( codec )
      const def = this.#dynamicpts.def.rtp[ codec ]
      if ( undefined !== def ) {
        /* suported audio */
        const m = this.getmedia( this.#dynamicpts.def.type[ codec ] )

        /* Don't allow duplicates */
        if( m.payloads.includes( codecn ) ) return

        m.rtp.push( def )
        // @ts-ignore
        m.payloads.push( def.payload )

        if ( undefined !== this.#dynamicpts.def.fmtp[ codec ] ) {
          m.fmtp.push( this.#dynamicpts.def.fmtp[ codec ] )
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
    // @ts-ignore
    this.sdp.msidSemantic = { 
      "semantic": "WMS", 
      "token": crypto.randomBytes( 16 ).toString( "hex" )
    }

    for( const m of this.sdp.media ) {
      const mmsid = crypto.randomBytes( 16 ).toString( "hex" )
      // @ts-ignore
      m.ssrcs = [
        { "id": ssrc, "attribute": "cname", "value": crypto.randomBytes( 16 ).toString( "hex" ) },
        // @ts-ignore
        { "id": ssrc, "attribute": "msid", "value": this.sdp.msidSemantic.token + " " + mmsid },
        // @ts-ignore
        { "id": ssrc, "attribute": "mslabel", "value": this.sdp.msidSemantic.token },
        { "id": ssrc, "attribute": "label", "value": mmsid }
      ]

      // @ts-ignore
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
      // @ts-ignore
      m.fingerprint = {
        "type": "sha-256",
        "hash": fingerprint
      }
      // @ts-ignore
      m.setup = actpass
    }

    return this
  }

  /**
   * Adds ICE candidate to SDP
   */
  addicecandidates( ip, port, icepwd ) {
    for( const m of this.sdp.media ) {
      // @ts-ignore
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

      // @ts-ignore
      m.iceUfrag = crypto.randomBytes( 8 ).toString( "hex" )
      // @ts-ignore
      m.icePwd = icepwd
    }

    return this
  }

  rtcpmux() {
    for( const m of this.sdp.media ) {
      // @ts-ignore
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

  /**
   * Gets a list of codecs (that we support) and return as an array of strings.
   * @param { string } type 
   * @returns { Array< string > } array of codec names in the format [ "pcma" ]
   */
  #codecs( type = "audio" ) {

    const audio = this.getmedia( type )

    /* work out an array of codecs on this side in the format of [ "pcma", "pcmu" ] */
    const ourcodecs = []
    for( const pt of audio.payloads ) {
      if( !this.#dynamicpts.haspt( pt ) ) continue
      if( this.#dynamicpts.getpt( "ilbc" ) == pt ) {
        if( -1 == getconfigforpt( audio, pt ).indexOf( "mode=30" ) )
          ourcodecs.push( this.#dynamicpts.getcodec( pt ) )
      } else {
        ourcodecs.push( this.#dynamicpts.getcodec( pt ) )
      }
    }

    return ourcodecs
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

    /* ensure other side is on the format [ "pcma", "pcmu" ] */
    other = this.alltocodecname( other )
    const ourcodecs = this.#codecs()

    /* intersection */
    let retval = other.filter( value => ourcodecs.includes( value ) )

    /* If fisrt only - i.e. select codec */
    if ( firstonly && 0 < retval.length ) {
      retval = [ retval[ 0 ] ]
      this.select( retval[ 0 ] )
    }

    const full = retval.join( " " )
    if( !full ) return false
    
    return full
  }

  /**
   * See other param in intersection. Confirms that we have 
   * support for at least one of the codecs in codecs
   * @param { Array< string > | string } codecs 
   */
  has( codecs ) {

    const ourcodecs = this.#codecs()
    codecs = this.alltocodecname( codecs )

    /* intersection */
    if( undefined === codecs.find( value => ourcodecs.includes( value ) ) ) return false

    return true

  }

  toString() {

    /* We need to convert payloads back to string to stop a , being added */
    const co = Object.assign( this.sdp )

    co.media.forEach( ( media, i, a ) => {
      if( Array.isArray( media.payloads ) ) {
        a[ i ].payloads = media.payloads.join( " " )
      }
    } )

    return sdptransform.write( co )
  }
}

module.exports = sdp
 