import type { CampusPoi } from '../../lib/campus-map'
import type { MapLocation } from '../../lib/campus-map-location'
import { MAP_CATEGORIES, mapDistance, poiCategory } from '../../lib/campus-map-presentation'
import { CampusNavigation } from '../CampusNavigation'
import { LocalPinPhotoGallery, PinPhotoGallery } from '../CampusPinPhotos'
import { FoxSheetPose } from '../fox/FoxSheetPose'
import { MapIcon } from './MapIcons'
import s from './PoiDetailSheet.module.css'
type Props={poi:CampusPoi;uid:string;location:MapLocation|null;busy:boolean;canSubmit:boolean;onClose:()=>void;onCheckin:()=>void;onSubmit:()=>void;requireLogin:()=>boolean}
export function PoiDetailSheet({poi,uid,location,busy,canSubmit,onClose,onCheckin,onSubmit,requireLogin}:Props){
  const type=MAP_CATEGORIES.find(c=>c.label===poiCategory(poi.category))!
  const local=poi.verification_status==='local'
  return <aside className={s.sheet} aria-label={`${poi.name}地点详情`}>
    <span className={s.handle} aria-hidden="true" />
    <button type="button" className={s.close} onClick={onClose} aria-label="关闭地点详情"><MapIcon name="close" /></button>
    <div className={s.title}><span className={s.icon} style={{color:type.color,background:type.background}}><MapIcon name={type.icon}/></span><div><h2>{poi.name}</h2><span className={s.meta}>{poi.category}{location?` · 距你 ${mapDistance(location,poi)}`:''}</span></div></div>
    <span className={`${s.status} ${poi.verification_status==='verified'?s.verified:''}`}>{poi.verification_status==='verified'?'✓ 已核验':local?'仅自己可见':'公开地图参考位置'}</span>
    {local?<LocalPinPhotoGallery key={`${uid}:${poi.id}`} poi={poi} uid={uid}/>:<PinPhotoGallery urls={poi.image_urls||[]}/>}
    {poi.note?<p className={s.note}>{poi.note}</p>:null}
    <div className={s.actions}><button type="button" className={s.checkin} onClick={onCheckin}><MapIcon name="checkin"/>在这里打卡</button>{local?<button type="button" disabled={busy||!canSubmit} title={canSubmit?undefined:'此校区尚未配置云端范围，可先保存在本机'} onClick={onSubmit}>提交审核</button>:null}</div>
    <CampusNavigation poi={poi} onRequireLogin={requireLogin}/>
    <div className={s.foxNote}><FoxSheetPose pose="walking"/><span>和阿狐一起，发现校园的小美好。</span></div>
  </aside>
}
