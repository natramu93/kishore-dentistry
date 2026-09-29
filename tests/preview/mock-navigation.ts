const noNavigation = () => {};
export function useRouter() {
  return { refresh: noNavigation, push: noNavigation, replace: noNavigation };
}
