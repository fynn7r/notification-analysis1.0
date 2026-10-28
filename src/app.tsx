/**
 * @file app.tsx
 * @description 应用路由配置入口
 * 定义了整个应用的页面路由结构，所有页面都嵌套在 Layout 布局组件内。
 * 路由列表：
 * - /          通知解析首页（ParsePage）
 * - /generator 通知生成器（GeneratorPage）
 * - /rules     综测加分规则管理（RulesPage）
 * - /reminders 提醒事项列表（RemindersPage）
 * - /history   历史解析记录（HistoryPage）
 * - /profile   个人中心与设置（ProfilePage）
 * - *          404 页面（NotFoundPage）
 */

import { Routes, Route } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { AuthProvider } from '@/hooks/useAuth';
import NotFoundPage from '@/pages/NotFoundPage/NotFoundPage';
import ParsePage from '@/pages/ParsePage/ParsePage';
import RulesPage from '@/pages/RulesPage/RulesPage';
import RemindersPage from '@/pages/RemindersPage/RemindersPage';
import HistoryPage from '@/pages/HistoryPage/HistoryPage';
import GeneratorPage from '@/pages/GeneratorPage/GeneratorPage';
import ProfilePage from '@/pages/ProfilePage/ProfilePage';
import LoginPage from '@/pages/LoginPage/LoginPage';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<ParsePage />} />
          <Route path="generator" element={<GeneratorPage />} />
          <Route path="rules" element={<RulesPage />} />
          <Route path="reminders" element={<RemindersPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
