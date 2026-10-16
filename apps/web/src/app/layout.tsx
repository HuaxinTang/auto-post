import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Auto Post — 社媒发布控制台',
  description: '开源社交媒体内容发布工具',
};

const nav = [
  { href: '/executors', label: '执行器' },
  { href: '/accounts', label: '账号' },
  { href: '/posts', label: '内容' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <header className="topbar">
          <div className="brand">Auto Post</div>
          <nav>
            {nav.map((n) => (
              <Link key={n.href} href={n.href}>
                {n.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
