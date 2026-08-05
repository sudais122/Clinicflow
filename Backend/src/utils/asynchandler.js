const AsyncHandler = (requestHandler) => {
  return (req, res) => {
    Promise.resolve(requestHandler(req, res)).catch((err));
  };
};

export default AsyncHandler;