export const createMutex = (): (<A>(
  operation: () => Promise<A>,
) => Promise<A>) => {
  let mutex = Promise.resolve();

  return <A>(operation: () => Promise<A>) =>
    new Promise<A>((resolve, reject) => {
      mutex = mutex.finally(() => {
        try {
          return operation().then(resolve, reject);
        } catch (error) {
          // A synchronous throw would otherwise leave the caller waiting on
          // a promise that never settles
          reject(error);
        }
      });
    });
};
