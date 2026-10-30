export type AuthContext =
  | {
      role: "user";
      userId: string;
      name: string;
      email: string;
    }
  | {
      role: "guest";
      guestId: string;
      name: string;
      roomId: string;
    };

export interface UserTokenPayload {
  sub: string;
  name: string;
  email: string;
  role: "user";
}

export interface GuestTokenPayload {
  sub: string;
  name: string;
  role: "guest";
  roomId: string;
}
