/// <reference types="@emotion/react/types/css-prop" />
import type { Chunk, Resolvers as WorkerResolvers, VideoDB } from './worker'

import { ClassAttributes, forwardRef, HTMLAttributes, MouseEventHandler, ReactEventHandler, SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState, VideoHTMLAttributes } from 'react'
import { createRoot } from 'react-dom/client'
import { call } from 'osra'
import { css, Global } from '@emotion/react'
import { appendBuffer, updateSourceBuffer as _updateSourceBuffer } from './utils'
import { openDB } from 'idb'


const useThrottle = (func: (...args: any[]) => any, limit: number, deps: any[] = []) =>
  useMemo(() => {
    let inThrottle
    let lastCallArgs
    const call = (...args: any[]) => {
      lastCallArgs = args
      if (!inThrottle) {
        func(...args)
        inThrottle = true
        setTimeout(() => {
          inThrottle = false
          if (lastCallArgs) {
            call(...lastCallArgs)
            lastCallArgs = undefined
          }
        }, limit)
      }
    }
    return call
  }, deps)

// const makeTransmuxer = async ({ id, size, stream: inStream }: { id, size: number, stream: ReadableStream }) => {
//   const [loadedTime, setLoadedTime] = useState()
//   const worker = new Worker('/worker.js', { type: 'module' })
//   const newChunk = (chunk: Chunk) => {
//     console.log('new chunk', chunkInfo)
//     setLoadedTime(chunk.endTime)
//   }
//   const { stream: streamOut, info, mime, mp4info } = await call<WorkerResolvers>(worker)('REMUX', { id, size, stream: inStream, newChunk })
//   return {
//     loadedTime,
//     info,
//     mime: mp4info.mime,
//     mp4info
//   }
// }

const useTransmuxer = ({ id, size, stream: inStream }: { id?: string, size?: number, stream?: ReadableStream }) => {
  // const [loadedTime, setLoadedTime] = useState<number>()
  const [info, setInfo] = useState()
  const [mime, setMime] = useState<string>()
  const [mp4Info, setMp4Info] = useState()
  const [chunks, setChunks] = useState<Chunk[]>([])
  const loadedTime = useMemo(() => chunks.at(-1)?.endTime, [chunks])
  const worker = useMemo(() => new Worker('/worker.js', { type: 'module' }), [])

  const newChunk = (chunk: Chunk) => {
    setChunks(chunks => [...chunks, chunk])
    // console.log('new chunk', chunk)
    // setLoadedTime(chunk.endTime)
  }

  useEffect(() => {
    if (!id || !size || !inStream) return
    call<WorkerResolvers>(worker)('REMUX', { id, size, stream: inStream, newChunk })
      .then(({ stream: streamOut, info, mime, mp4info }) => {
        setInfo(info)
        setMime(mp4info.mime)
        setMp4Info(mp4info)
      })
  }, [id, size, inStream])

  return {
    loadedTime,
    info,
    mime,
    mp4Info,
    chunks
  }
}

export const db =
  openDB<VideoDB>('fkn-media-player', 1, {
    upgrade(db) {
      db.createObjectStore('index', { keyPath: 'id' })
      db.createObjectStore('chunks')
    }
  })

const useSourceBuffer = ({ id, info, mime, chunks, video, currentTime }: { id?: string, info?: any, mime?: string, chunks: Chunk[], video: HTMLVideoElement, currentTime: number }) => {
  const [duration, setDuration] = useState<number>()
  const [mediaSource] = useState(new MediaSource())
  const [sourceUrl] = useState<string>(URL.createObjectURL(mediaSource))
  const [sourceBuffer, setSourceBuffer] = useState<SourceBuffer>()

  const __updateSourceBuffer = useMemo(() => {
    if (!sourceBuffer) return
    return _updateSourceBuffer(sourceBuffer, async (index) => {
      // console.log(`get chunk ${id}-${index}`)
      const arrayBuffer = await (await db).get('chunks', `${id}-${index}`)
      if (!arrayBuffer) return
      return new Uint8Array(arrayBuffer)
    })
  }, [sourceBuffer])

  const updateSourceBuffer = useThrottle((...args) => __updateSourceBuffer?.(...args), 250, [__updateSourceBuffer])

  useEffect(() => {
    if (!id || !info || !mime || sourceBuffer) return
    const registerSourceBuffer = async () => {
      mediaSource.duration = info.input.duration
      const sourceBuffer = mediaSource.addSourceBuffer(mime)
      sourceBuffer.mode = 'segments'
      setSourceBuffer(sourceBuffer)
      setDuration(info.input.duration)
    }
    if(mediaSource.readyState === 'closed') {
      mediaSource.addEventListener(
        'sourceopen',
        () => registerSourceBuffer(),
        { once: true }
      )
    } else {
      registerSourceBuffer()
    }
  }, [id, info, mime])

  useEffect(() => {
    if (!updateSourceBuffer) return
    updateSourceBuffer({ currentTime, chunks })
  }, [currentTime, updateSourceBuffer, chunks])

  return { duration, mediaSource, sourceUrl, sourceBuffer }
}

const chromeStyle = css`
  --background-padding: 2rem;
  display: grid;
  grid-template-rows: 1fr;
  overflow: hidden;

  &.hide {
    cursor: none;

    .bottom {
      opacity: 0;
    }
  }

  .overlay {
    display: grid;
    grid-column: 1;
    grid-row: 1;
    display: grid;
    height: 100%;
    width: 100%;
    justify-items: center;
    align-items: center;

    canvas {
      grid-column: 1;
      grid-row: 1;
      height: 100%;
      width: 100%;
    }

    .loading {
      grid-column: 1;
      grid-row: 1;
    }
  }

  .bottom {
    grid-column: 1;
    grid-row: 1;
    align-self: end;
    height: calc(4.8rem + var(--background-padding));
    width: 100%;
    padding: 0 2rem;
    margin: 0 auto;


    /* subtle background black gradient for scenes with high brightness to properly display white progress bar */
    padding-top: var(--background-padding);
    background: linear-gradient(0deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.1) calc(100% - 1rem), rgba(0,0,0,0) 100%);

    .progress-bar {
      position: relative;
      height: .4rem;
      background-color: hsla(0, 100%, 100%, .2);
      cursor: pointer;
      user-select: none;

      .load {
        transform-origin: 0 0;
        background-color: hsla(0, 100%, 100%, .4);
        position: absolute;
        bottom: 0;
        height: .4rem;
        width: 100%;
      }
      .play {
        transform-origin: 0 0;
        background-color: hsla(0, 100%, 50%, .8);
        position: absolute;
        bottom: 0;
        height: .4rem;
        width: 100%;
      }
      .padding {
        position: absolute;
        bottom: -4px;
        height: 1.6rem;
        width: 100%;
      }
    }

    .controls {
      height: 100%;
      display: grid;
      align-items: center;
      grid-template-columns: 5rem 20rem auto 5rem 5rem;
      grid-gap: 1rem;
      color: #fff;
      user-select: none;

      .picture-in-picture {
        display: grid;
        justify-items: center;
        cursor: pointer;
      }

      .fullscreen {
        display: grid;
        justify-items: center;
        cursor: pointer;
      }

      .play-button {
        color: #fff;
        background-color: transparent;
        border: none;
        cursor: pointer;
      }

      .time {
        font-family: Roboto;
        padding-bottom: .5rem;
      }
    }
  }
`

const Chrome = (({ isPlaying, loading, duration, loadedTime, currentTime, pictureInPicture, fullscreen, play, seek, ...rest }: { isPlaying?: boolean, loading?: boolean, duration?: number, loadedTime?: number, currentTime?: number, pictureInPicture: MouseEventHandler<HTMLDivElement>, fullscreen: MouseEventHandler<HTMLDivElement>, play: MouseEventHandler<HTMLDivElement>, seek: (time: number) => void } & HTMLAttributes<HTMLDivElement>) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const progressBarRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setFullscreen] = useState(false)
  const [hidden, setHidden] = useState(true)
  const autoHide = useRef<number>()
  const isPictureInPictureEnabled = useMemo(() => document.pictureInPictureEnabled, [])
  const [scrubbing, setScrubbing] = useState(false)

  const mouseMove: MouseEventHandler<HTMLDivElement> = (ev) => {
    setHidden(false)
    if (autoHide.current) clearInterval(autoHide.current)
    const timeout = setTimeout(() => {
      setHidden(true)
    }, 5_000) as unknown as number
    autoHide.current = timeout
  }

  const mouseOut: React.DOMAttributes<HTMLDivElement>['onMouseOut'] = (ev) => {
    if (ev.currentTarget.parentElement !== ev.relatedTarget && ev.relatedTarget !== null) return
    setHidden(true)
  }

  const clickPlay = (ev) => {
    play(ev)
  }

  const clickFullscreen = (ev) => {
    setFullscreen(value => !value)
    fullscreen(ev)
  }

  const scrub = (ev) => {
    setScrubbing(true)
    if (!progressBarRef.current || !duration) return
    const { clientX: x } = ev
    const { left, right } = progressBarRef.current.getBoundingClientRect()
    const time = Math.min(((x - left) / (right - left)) * duration, duration)
    seek(time)
  }

  useEffect(() => {
    if (!scrubbing) return
    const mouseUp = (ev: MouseEvent) => {
      setScrubbing(false)
    }
    const mouseMove = (ev: MouseEvent) => {
      if (!progressBarRef.current || !duration) return
      const { clientX: x } = ev
      const { left, right } = progressBarRef.current.getBoundingClientRect()
      const time = Math.min(((x - left) / (right - left)) * duration, duration)
      seek(time)
    }
    document.addEventListener('mousemove', mouseMove)
    document.addEventListener('mouseup', mouseUp)
    return () => {
      document.removeEventListener('mousemove', mouseMove)
      document.removeEventListener('mouseup', mouseUp)
    }
  }, [scrubbing])

   return (
    <div {...rest} css={chromeStyle} onMouseMove={mouseMove} onMouseOut={mouseOut} className={`chrome ${rest.className ?? ''} ${hidden ? 'hide' : ''}`}>
      <div className="overlay" onClick={clickPlay}>
        <canvas ref={canvasRef}/>
        {
          loading
            ? (
              <svg
                className="loading"
                xmlns="http://www.w3.org/2000/svg"
                style={{
                  display: 'block',
                  shapeRendering: 'auto',
                  animationPlayState: 'running',
                  animationDelay: '0s',
                }}
                width="100" height="100"
                viewBox="0 0 100 100"
                preserveAspectRatio="xMidYMid"
                >
                <circle
                  cx="50"
                  cy="50"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="9"
                  r="35"
                  strokeDasharray="164.93361431346415 56.97787143782138"
                  style={{ animationPlayState: 'running', animationDelay: '0s' }}>
                  <animateTransform
                    attributeName="transform"
                    type="rotate"
                    repeatCount="indefinite"
                    dur="1s"
                    values="0 50 50;360 50 50"
                    keyTimes="0;1"
                    style={{ animationPlayState: 'running', animationDelay: '0s' }}
                  />
                </circle>
              </svg>
            )
            : null
        }
      </div>
      <div className="bottom">
        <div className="preview"></div>
        <div className="progress-bar" ref={progressBarRef}>
          <div className="progress"></div>
          {/* bar showing the currently loaded progress */}
          <div className="load" style={{ transform: `scaleX(${1 / ((duration ?? 0) / (loadedTime ?? 0))})` }}></div>
          {/* bar to show when hovering to potentially seek */}
          <div className="hover"></div>
          {/* bar displaying the current playback progress */}
          <div className="play" style={{
            transform: `scaleX(${
              typeof duration !== 'number' || typeof currentTime !== 'number'
                ? 0
                : 1 / ((duration ?? 0) / (currentTime ?? 0))
            })`
          }}>
          </div>
          <div className="chapters"></div>
          <div className="scrubber"></div>
          <div className="padding" onMouseDown={scrub}></div>
        </div>
        <div className="controls">
          <button className="play-button" type="button" onClick={clickPlay}>
            {
              isPlaying
                ? <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="feather feather-pause"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
                : <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="feather feather-play"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            }
          </button>
          <div className="time">
            <span>{new Date((currentTime ?? 0) * 1000).toISOString().substr(11, 8)}</span>
            <span> / </span>
            <span>{duration ? new Date(duration * 1000).toISOString().substr(11, 8) : ''}</span>
          </div>
          <div></div>
          {
            isPictureInPictureEnabled
              ? (
                <div className="picture-in-picture" onClick={pictureInPicture}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="21" height="14" rx="2" ry="2"></rect><rect x="12.5" y="8.5" width="8" height="6" rx="2" ry="2"></rect></svg>
                </div>
              )
              : null
          }
          <div className="fullscreen" onClick={clickFullscreen}>
            {
              isFullscreen
                ? <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="feather feather-minimize"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path></svg>
                : <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="feather feather-maximize"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>
            }
          </div>
        </div>
      </div>
    </div>
  )
})

const style = css`
  display: grid;
  justify-content: center;
  background-color: #111;

  video {
    pointer-events: none;
    grid-column: 1;
    grid-row: 1;

    height: 100%;
    max-width: 100vw;
    background-color: black;
  }

  .chrome {
    grid-column: 1;
    grid-row: 1;
  }
`

const FKNVideo = forwardRef<HTMLVideoElement, VideoHTMLAttributes<HTMLInputElement> & { id?: string, size?: number, stream?: ReadableStream<Uint8Array> }>(({ id, size, stream: inStream }, ref) => {
  const { loadedTime, mime, info, headerChunk, chunks } = useTransmuxer({ id, size, stream: inStream })
  const [loading, setLoading] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>()
  const [isPlaying, setIsPlaying] = useState(!(videoRef?.current?.paused ?? true))
  const [currentTime, setCurrentTime] = useState(0)
  const { duration, sourceUrl } = useSourceBuffer({ id, mime, info, headerChunk, chunks, currentTime })

  const waiting: React.DOMAttributes<HTMLVideoElement>['onWaiting'] = (ev) => {
    setLoading(true)
  }

  const seeking: React.DOMAttributes<HTMLVideoElement>['onSeeking'] = (ev) => {

  }

  const seek = (time: number) => {
    if (!videoRef.current) return
    videoRef.current.currentTime = time
    setCurrentTime(videoRef.current?.currentTime ?? 0)
  }

  const timeUpdate: React.DOMAttributes<HTMLVideoElement>['onTimeUpdate'] = (ev) => {
    setCurrentTime(videoRef.current?.currentTime ?? 0)
    setLoading(false)
  }

  const playbackUpdate = (playing: boolean) => (ev: SyntheticEvent<HTMLVideoElement, Event>) => {
    setIsPlaying(playing)
  }

  const pictureInPicture = () => {
    if (document.pictureInPictureElement) return document.exitPictureInPicture()
    videoRef.current?.requestPictureInPicture()
  }

  const fullscreen = () => {
    if (document.fullscreenElement) return document.exitFullscreen()
    // @ts-ignore
    containerRef.current?.requestFullscreen()
  }

  const play = async () => {
    if (!isPlaying) await videoRef.current?.play()
    else await videoRef.current?.pause()
  }

  const refFunction: ClassAttributes<HTMLVideoElement>['ref'] = (element) => {
    if (typeof ref === 'function') ref(element)
    if (ref && 'current' in ref) ref.current = element
    videoRef.current = element ?? undefined
  }
  
  return (
    <div css={style} ref={containerRef}>
      <video
        ref={refFunction}
        src={sourceUrl}
        onWaiting={waiting}
        onSeeking={seeking}
        onTimeUpdate={timeUpdate}
        onPlay={playbackUpdate(true)}
        onPause={playbackUpdate(false)}
        autoPlay={true}
      />
      <Chrome
        className="chrome"
        isPlaying={isPlaying}
        video={videoRef}
        loading={loading}
        duration={duration}
        currentTime={currentTime}
        loadedTime={loadedTime}
        pictureInPicture={pictureInPicture}
        fullscreen={fullscreen}
        play={play}
        seek={seek}
      />
    </div>
  )
})

const FKNMediaPlayer = ({ id, size, stream }: { id?: string, size?: number, stream?: ReadableStream<Uint8Array> }) => {
  // const { loadedTime, mime, info, headerChunk } = useTransmuxer({ id, size, stream: inStream })
  // const [transmuxer, setTransmuxer] = useState<Awaited<ReturnType<typeof makeTransmuxer>>>()
  // const [duration, setDuration] = useState<number>()
  // const [mediaSource] = useState(new MediaSource())
  // const [sourceBuffer, setSourceBuffer] = useState<SourceBuffer>()

  // useEffect(() => {
  //   if (!info) return
  //   setDuration(info.input.duration)
  //   mediaSource.duration = info.input.duration
  // }, [info])

  // useEffect(() => {
  //   if (!info || !mime || !headerChunk) return
  //   mediaSource.addEventListener(
  //     'sourceopen',
  //     () => {
  //       mediaSource.duration = info.input.duration
  //       const sourceBuffer = mediaSource.addSourceBuffer(mime)
  //       sourceBuffer.mode = 'segments'
  //       setSourceBuffer(sourceBuffer)
  //       sourceBuffer.appendBuffer(headerChunk)
  //       setDuration(info.input.duration)
  //     },
  //     { once: true }
  //   )
  // }, [info, mime, headerChunk])

  // useEffect(() => {
  //   if (!id || !size || !inStream) return
  //   makeTransmuxer({ id, size, stream: inStream }).then(setTransmuxer)
  // }, [size, inStream])

  return <FKNVideo id={id} size={size} stream={stream}/>
  // return <FKNVideo duration={duration} loadedTime={loadedTime} mediaSource={mime && headerChunk ? mediaSource : undefined}/>
}

export default FKNMediaPlayer


const mountStyle = css`
  display: grid;
  height: 100%;
  width: 100%;
`

const Mount = () => {
  const [size, setSize] = useState<number>()
  const [stream, setStream] = useState<ReadableStream<Uint8Array>>()

  useEffect(() => {
    fetch('./video.mkv')
      .then(({ headers, body }) => {
        if (!body || !headers.get('Content-Length')) throw new Error('no stream or Content-Length returned from the response')
        setSize(Number(headers.get('Content-Length')))
        setStream(body)
      })
  }, [])

  return (
    <div css={mountStyle}>
      <FKNMediaPlayer id={'test'} size={size} stream={stream}/>
    </div>
  )
}

const globalStyle = css`
  @import '/index.css';
  @import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@300;400;500;600;700&family=Fira+Sans:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,500;1,600;1,700;1,800;1,900&family=Montserrat:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&family=Roboto:ital,wght@0,100;0,300;0,400;0,500;0,700;0,900;1,100;1,300;1,400;1,500;1,700;1,900&display=swap');

  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  html {
    font-size: 62.5%;
    height: 100%;
    width: 100%;
  }

  body {
    margin: 0;
    height: 100%;
    width: 100%;
    font-size: 1.6rem;
    font-family: Fira Sans;
    color: #fff;
    
    font-family: Montserrat;
    // font-family: "Segoe UI", Roboto, "Fira Sans",  "Helvetica Neue", Arial, sans-serif;
  }

  body > div {
    height: 100%;
    width: 100%;
  }

  a {
    color: #777777;
    text-decoration: none;
  }

  a:hover {
    color: #fff;
    text-decoration: underline;
  }

  ul {
    list-style: none;
  }
`

createRoot(
  document.body.appendChild(document.createElement('div'))
).render(
  <>
    <Global styles={globalStyle}/>
    <Mount/>
  </>
)
