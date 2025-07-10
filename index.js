const express = require('express');
const cors = require('cors');
require('dotenv').config()

const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY);

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');


//middleware
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());



// console.log(process.env.DB_USER) zap-shift-user-db
// console.log(process.env.DB_PASS) xDQJoqpixMi3Jrqg

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.l84br15.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: ServerApiVersion.v1,
    tls: true,
    tlsAllowInvalidCertificates: true
});


async function run() {
    try {

        //databasename change as needed

        const database = client.db("Zap_shift_DB")
        const user_Collection = database.collection("Users")
        const parcelCollection = database.collection("Parcels");
        const paymentsCollection = database.collection("payments");


        //curd operation start
        app.post('/users', async (req, res) => {
            const email = req.body.email
            const userExist = await user_Collection.findOne({ email })
            if (userExist) {
                return res.status(200).send({ message: 'user already exists', inserted: false })
            }
            const user = req.body
            const result = await user_Collection.insertOne(user)
            res.send(result)

        })





        // Get all parcels (for admin view)
        app.get('/parcels', async (req, res) => {
            try {
                const result = await parcelCollection.find().sort({ creation_date: -1 }).toArray();
                res.status(200).json({
                    success: true,
                    data: result
                });
            } catch (error) {
                console.error("Error fetching all parcels:", error);
                res.status(500).json({ error: "Internal server error" });
            }
        });

        // Get parcels for a specific user (filtered by email)
        app.get('/parcels/user/:email', async (req, res) => {
            try {
                const email = req.params.email;

                if (!email) {
                    return res.status(400).json({ error: "Email parameter is required" });
                }

                const result = await parcelCollection.find({
                    created_by: email
                }).sort({
                    creation_date: -1
                }).toArray();

                res.status(200).json({
                    success: true,
                    data: result
                });
            } catch (error) {
                console.error("Error fetching user parcels:", error);
                res.status(500).json({ error: "Internal server error" });
            }
        });

        // Get a single parcel by tracking ID
        app.get('/parcels/:tracking_id', async (req, res) => {
            try {
                const tracking_id = req.params.tracking_id;

                if (!tracking_id) {
                    return res.status(400).json({ error: "Tracking ID parameter is required" });
                }

                // const result = await parcelCollection.findOne({
                //     tracking_id: tracking_id
                // });

                const result = await parcelCollection.findOne({
                    _id: new ObjectId(tracking_id)
                });


                if (!result) {
                    return res.status(404).json({ error: "Parcel not found" });
                }

                res.status(200).json({
                    success: true,
                    data: result
                });
            } catch (error) {
                console.error("Error fetching parcel by tracking ID:", error);
                res.status(500).json({ error: "Internal server error" });
            }
        });

        // Create parcel API
        app.post('/parcels', async (req, res) => {
            try {
                const parcelData = req.body;

                // Basic validation
                if (!parcelData.tracking_id || !parcelData.created_by) {
                    return res.status(400).json({ error: "Missing required fields" });
                }

                // Insert the parcel into MongoDB
                const result = await parcelCollection.insertOne(parcelData);

                res.status(201).json({
                    success: true,
                    message: "Parcel created successfully",
                    data: result
                    // insertedId: result.insertedId
                });

                //res.status(201).send(result);


            } catch (error) {
                console.error("Error creating parcel:", error);
                res.status(500).json({ error: "Internal server error" });
            }
        });


        // payment stripe post

        app.post('/create-payment-intent', async (req, res) => {

            const ammountIncents = req.body.ammountIncents
            try {
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: ammountIncents, // Amount in cents
                    currency: 'usd',
                    payment_method_types: ['card'],
                });
                res.json({ clientSecret: paymentIntent.client_secret });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });


        // PAYMENT HISTORY AND UPDATE   parcel status
        app.post('/payments', async (req, res) => {
            try {
                const { parcelId, email, ammount, paymentMethod, transactionId } = req.body
                //update parcel payment status
                const updateResult = await parcelCollection.updateOne(
                    { _id: new ObjectId(parcelId) },
                    {
                        $set: {
                            payment_status: 'paid'
                        }
                    }
                )

                //insert payment record
                const paymentDoc = {
                    parcelId,
                    email,
                    ammount,
                    paymentMethod,
                    transactionId,
                    paid_at_string: new Date().toString(),
                    paid_at: new Date()
                }

                const paymentResult = await paymentsCollection.insertOne(paymentDoc)

                res.status(201).send({
                    message: 'payment recorded and parcel marked as paid',
                    insertedId: paymentResult.insertedId
                })
            }
            catch (error) {
                res.status(500).json({ error: "Internal server error" });
            }
        })


        // GET payment history by user email
        app.get('/payments/:email', async (req, res) => {
            try {
                const email = req.params.email;

                // Validate email format
                if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                    return res.status(400).json({ error: "Invalid email format" });
                }

                // Find all payments for this user, sorted by payment date (newest first)
                const payments = await paymentsCollection.find({ email })
                    .sort({ paid_at: -1 })  // -1 for descending order (newest first)
                    .toArray();

                // Optionally: Join with parcel data if needed
                const paymentsWithParcelDetails = await Promise.all(
                    payments.map(async payment => {
                        const parcel = await parcelCollection.findOne({
                            _id: new ObjectId(payment.parcelId)
                        });
                        return {
                            ...payment,
                            parcelDetails: parcel || null
                        };
                    })
                );

                res.status(200).json({
                    success: true,
                    count: payments.length,
                    data: paymentsWithParcelDetails // or just 'payments' if you don't need parcel details
                });
            } catch (error) {
                console.error("Error fetching payment history:", error);
                res.status(500).json({
                    error: "Internal server error",
                    details: error.message
                });
            }
        });


    

        // Delete parcel API
        app.delete('/parcels/:id', async (req, res) => {
            try {
                const id = req.params.id;

                // Validate the ID
                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({ error: "Invalid parcel ID" });
                }

                // Convert string ID to MongoDB ObjectId
                const objectId = new ObjectId(id);

                // Delete the parcel from MongoDB
                const result = await parcelCollection.deleteOne({ _id: objectId });

                if (result.deletedCount === 0) {
                    return res.status(404).json({ error: "Parcel not found" });
                }

                res.status(200).json({
                    success: true,
                    message: "Parcel deleted successfully"
                });

            } catch (error) {
                console.error("Error deleting parcel:", error);
                res.status(500).json({ error: "Internal server error" });
            }
        });

        //curd operation end

        //await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    }
    catch (error) {
        console.error("MongoDB connection error:", error);
    }
    finally {
    }
}

run().catch(console.dir);






app.get('/', (req, res) => {
    res.send(' Hello World! , server is running');
});

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
});
