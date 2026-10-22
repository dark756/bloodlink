import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { getDb } from "@/lib/db";

const handler = NextAuth({
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async signIn({ user }) {
      if (!user?.email) return false;
      const db = await getDb();
      // Upsert so two first-time logins at once can't create duplicate users.
      await db.collection("users").updateOne(
        { email: user.email },
        {
          $setOnInsert: {
            email: user.email,
            name: user.name ?? null,
            role: "user",
            isProfileComplete: false,
            createdAt: new Date(),
          },
        },
        { upsert: true }
      );
      return true;
    },

    // jwt() is the only callback that touches the database. It re-reads the user
    // on every session read, which is how isProfileComplete reaches the session
    // cookie after the profile form is saved (the form also calls update() so the
    // cookie refreshes immediately). Don't limit this to sign-in without adding
    // another way to refresh the token.
    async jwt({ token, user }) {
      const email = user?.email ?? token.email;
      if (!email) return token;
      const db = await getDb();
      const dbUser = await db
        .collection("users")
        .findOne({ email }, { projection: { role: 1, isProfileComplete: 1 } });
      token.userId = dbUser?._id?.toString() ?? null;
      token.role = dbUser?.role ?? "user";
      token.isProfileComplete = dbUser?.isProfileComplete === true;
      return token;
    },

    // session() only reshapes the token for the client.
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId ?? null;
        session.user.role = token.role ?? "user";
        session.user.isProfileComplete = token.isProfileComplete === true;
      }
      return session;
    },
  },
});

export { handler as GET, handler as POST };
