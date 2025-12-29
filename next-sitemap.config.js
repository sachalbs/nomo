/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: 'https://nomo-juridique.fr',
  generateRobotsTxt: true,
  generateIndexSitemap: false,
  exclude: [
    '/api/*',
    '/auth/*',
    '/dashboard/*',
    '/admin/*',
  ],
  robotsTxtOptions: {
    policies: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/auth/', '/dashboard/', '/admin/'],
      },
    ],
    additionalSitemaps: [],
  },
};
