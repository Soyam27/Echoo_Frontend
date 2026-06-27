import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const AUTH_REQUIRED = ['/posts', '/chat', '/oauth/instagram']
const AUTH_ONLY = ['/login', '/signup']

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const token = request.cookies.get('echoo_token')?.value

  const needsAuth = AUTH_REQUIRED.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  )
  const isAuthPage = AUTH_ONLY.some((p) => pathname === p)

  if (needsAuth && !token) {
    const url = new URL('/login', request.url)
    url.searchParams.set('redirect', pathname + request.nextUrl.search)
    return NextResponse.redirect(url)
  }

  if (isAuthPage && token) {
    return NextResponse.redirect(new URL('/posts', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
