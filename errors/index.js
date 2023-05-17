exports.handle404 = (err, req, res, next) => {
    if (err.status === 404) {
      res.status(404).send({
        status: 404,
        message: err.message || 'Sorry, the page you have entered does not exist. Please try again',
      });
    } else {
      next(err, req, res, next);
    }
  };
  
  exports.handle422 = (err, req, res, next) => {
    if (err.code === '23505' || err.code === '23503') {
      res.status(422).json({
        message: 'Sorry, but the key you entered already exists',
      });
    } else {
      next(err, req, res, next);
    }
  };
  
  exports.handle400 = (err, req, res, next) => {
    if (err.code === '42703' || err.code === '22P02') {
      res.status(400).json({
        message:
          'Sorry, an incorrect format has been detected. Ensure you have typed in the correct format and try again',
      });
    } else if (err.status === 400) {
      res.status(400).json({
        message: err.message,
      });
    } else next(err, req, res, next);
  };
  
  exports.handle405 = (req, res, next) => {
    res.status(405).json({ message: 'Method Not Allowed' });
  };
  
  exports.handle500 = (err, req, res, next) => {
    res.status(500).send({ message: 'Oops! Something went wrong' });
  };
  