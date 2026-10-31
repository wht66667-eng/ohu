import { PageHeader } from '../components/PageHeader'
import { PluginMarketplace } from '../components/PluginMarketplace'
import styles from './plugin-marketplace-page.module.css'

export function PluginMarketplacePage() {
  return <div className={styles.page}>
    <PageHeader title="哦狐插件" />
    <section className={styles.intro}>
      <span aria-hidden="true">✦</span>
      <div><h2>把常用的小工具装进哦狐</h2><p>插件由哦狐审核并随 App 版本发布。开源项目用于启发设计，页面不会下载或运行第三方代码。</p></div>
    </section>
    <PluginMarketplace />
  </div>
}
