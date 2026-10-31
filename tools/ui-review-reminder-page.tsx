/** NON-PRODUCTION. The production course/display settings components with inert bridge fixtures. */
import { CourseReminderSettings } from '../src/components/CourseReminderSettings'
import { ExamReminderSettings } from '../src/components/ExamReminderSettings'
import { ReminderDisplaySettings } from '../src/components/ReminderDisplaySettings'
import { PageHeader } from '../src/components/PageHeader'

export function ReminderSettingsPreview() {
  return <div className="ui-review-reminders" data-reminder-settings-preview>
    <PageHeader title="通知与提醒" />
    <div className="ui-review-reminder-content">
      <p className="ui-review-reminder-mark" role="note">本地合成预览 · 保存偏好只影响此预览，未安排系统通知。</p>
      <CourseReminderSettings />
      <ExamReminderSettings />
      <ReminderDisplaySettings />
    </div>
  </div>
}
