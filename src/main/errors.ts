/** An error whose message is safe and useful to show the user as-is. Anything else becomes a generic message. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UserFacingError'
  }
}
