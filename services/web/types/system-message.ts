/** Surfaces a system message can be scoped to (#17b, port from go experimental branch). */
export type SystemMessagePlacement = 'editor' | 'hub' | 'auth'

export type SystemMessage = {
  _id: string
  content: string
  /**
   * Where this message appears ('editor' | 'hub' | 'auth').
   * Missing or empty list → visible on ALL pages (legacy behavior).
   */
  placements?: SystemMessagePlacement[]

  /**
   * Dismiss (X) button hidden for this message; the banner stays visible.
   * Off by default.
   */
  unremovable?: boolean
}

export type SuggestedLanguage = {
  url: string
  imgUrl: string
  lngCode: string
  lngName: string
}
