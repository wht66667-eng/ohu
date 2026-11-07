import { useEffect, useRef, useState } from 'react'

const prefix = 'ohu:friend:v1:'
function decodeTarget(value: string) {
  const id = value.startsWith(prefix) ? value.slice(prefix.length) : ''
  return /^[A-Za-z0-9_.:@-]{1,128}$/.test(id) ? id : ''
}

export function MyFriendQr({ uid }: { uid: string }) {
  const [url, setUrl] = useState('')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    import('qrcode').then(({ default: qr }) => qr.toDataURL(prefix + uid, { width: 240, margin: 4 }))
      .then(value => { if (active) setUrl(value) }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [uid])
  return url ? <img src={url} width="200" height="200" alt="我的哦狐好友二维码" style={{ display:'block', margin:'auto', maxWidth:'100%', height:'auto' }} /> : <p role="status">{failed ? '生成失败，请重新进入此页。' : '正在生成二维码…'}</p>
}

async function readFrame(source: HTMLVideoElement | HTMLImageElement, width: number, height: number, canvas: HTMLCanvasElement) {
  if (!width || !height) return ''
  const scale = Math.min(1, 1000 / Math.max(width,height))
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw Error('无法读取图像')
  context.drawImage(source,0,0,canvas.width,canvas.height)
  const pixels = context.getImageData(0,0,canvas.width,canvas.height)
  const { default: decode } = await import('jsqr')
  return decode(pixels.data,pixels.width,pixels.height)?.data || ''
}

export function FriendScanner({ uid, onTarget }: { uid: string; onTarget: (id: string) => void }) {
  const [camera,setCamera] = useState(false)
  const [hint,setHint] = useState('')
  const video = useRef<HTMLVideoElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const callback = useRef(onTarget)
  callback.current = onTarget
  const generation = useRef(0)
  function accept(raw: string) {
    const target = decodeTarget(raw)
    if (!target || target === uid) {
      setHint(target ? '这是你自己的二维码。' : '请使用哦狐生成的好友二维码。')
      return
    }
    callback.current(target)
    setHint('已识别好友，请确认后发送申请。')
  }
  useEffect(() => () => { generation.current++ }, [])
  useEffect(() => {
    if (!camera) return
    let active = true
    let stream: MediaStream | undefined
    let timer: ReturnType<typeof setTimeout>
    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode:'environment' }, audio:false })
        if (!active) { stream.getTracks().forEach(track => track.stop()); return }
        const player = video.current!
        player.srcObject = stream
        await player.play()
        const canvas = document.createElement('canvas')
        async function scan() {
          if (!active) return
          try {
            const raw = player.readyState >= 2 ? await readFrame(player,player.videoWidth,player.videoHeight,canvas) : ''
            if (!active) return
            if (raw) { accept(raw); setCamera(false); return }
            timer = setTimeout(scan,180)
          } catch { if (active) { setHint('读取失败，可从相册识别。'); setCamera(false) } }
        }
        void scan()
      } catch { if (active) { setHint('无法打开相机，请允许相机权限或从相册识别。'); setCamera(false) } }
    }
    void start()
    return () => { active=false; clearTimeout(timer); stream?.getTracks().forEach(track=>track.stop()) }
  }, [camera,uid])
  async function fromFile(file?: File) {
    if (!file) return
    const ticket = ++generation.current
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.src=url
      await img.decode()
      const raw = await readFrame(img,img.naturalWidth,img.naturalHeight,document.createElement('canvas'))
      if (ticket === generation.current) accept(raw)
    } catch { if (ticket === generation.current) setHint('图片无法识别，请选择清晰的好友二维码。') }
    finally { URL.revokeObjectURL(url) }
  }
  return <div>
    <button type="button" className="auth-btn" onClick={()=>{ generation.current++; callback.current(''); setHint(''); setCamera(!camera) }}>{camera ? '关闭相机' : '扫描好友二维码'}</button>
    {camera && <video ref={video} muted playsInline style={{width:'100%',maxHeight:280}} aria-label="相机扫码预览" />}
    <button type="button" className="auth-link" onClick={()=>{ setCamera(false); callback.current(''); picker.current?.click() }}>从相册识别</button>
    <input ref={picker} type="file" accept="image/*" hidden onChange={e=>{void fromFile(e.target.files?.[0]); e.target.value=''}} />
    <p role="status">{hint}</p>
  </div>
}
