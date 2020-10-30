module.exports = {
  async redirects() {
    return [
      {
        source: '/',
        destination: '/feed/top',
        permanent: false,
      },
    ]
  },
}
