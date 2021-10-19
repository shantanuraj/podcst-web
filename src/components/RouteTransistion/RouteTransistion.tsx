import { useRouter } from "next/router";
import { useEffect, useState } from "react";

import { LoadBar } from "../../ui/LoadBar";

export function RouteTransistion() {
  const [inTransistion, setInTransistion] = useState(false);
  const router = useRouter();
  useEffect(() => {
    const startTransistion = () => setInTransistion(true);
    const endTransistion = () => setInTransistion(false);

    router.events.on('routeChangeStart', startTransistion);
    router.events.on('routeChangeComplete', endTransistion);
    router.events.on('routeChangeError', endTransistion);

    return () => {
      router.events.off('routeChangeStart', startTransistion);
      router.events.off('routeChangeComplete', endTransistion);
      router.events.off('routeChangeError', endTransistion);
    }
  }, [router]);
  return (
    inTransistion ? <LoadBar /> : null
  );
}