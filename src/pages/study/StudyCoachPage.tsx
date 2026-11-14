import { PageHeader } from '../../components/PageHeader'
import { CoachPreview } from '../../components/study/CoachPreview'

export function StudyCoachPage() {
  return <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
    <PageHeader title="阿狐学习教练" />
    <main style={{ padding: '10px 14px 90px', maxWidth: 960, marginInline: 'auto' }}>
      <CoachPreview />
    </main>
  </div>
}
