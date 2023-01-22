export const RequestBody = (method: string, data: any) => {
  let HeadersConfig = new Headers({ "Content-Type": "application/json" });
  let options: any = {
    method: method,
    headers: HeadersConfig,
    redirect: "follow",
    credentials: "include",
  };
  if (data) {
    options.body = JSON.stringify(data);
  }
  return options;
};

