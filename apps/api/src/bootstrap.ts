import { prisma } from '@auto-post/db';

export async function bootstrapOrg() {
  const name = process.env.DEFAULT_ORG_NAME ?? '默认团队';
  const slug = process.env.DEFAULT_ORG_SLUG ?? 'default';
  const existing = await prisma.organization.findUnique({ where: { slug } });
  if (!existing) {
    await prisma.organization.create({ data: { name, slug } });
    console.log(`[bootstrap] organization "${name}" created`);
  }
}

export async function getDefaultOrgId(): Promise<string> {
  const slug = process.env.DEFAULT_ORG_SLUG ?? 'default';
  const org = await prisma.organization.findUnique({ where: { slug } });
  if (!org) throw new Error('default organization not found');
  return org.id;
}
